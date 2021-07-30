/*
 * Copyright 2019 Gary Smith <gary.smith.rsa@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
30/07/21
Changed the battery check period to 120s. 1) The rolling average voltage needs time to drop
or the routine sets to float twice in short succession but also to not keep trying too often 
when another charger is controlling the battery voltage.


Remmed out most of the debug statements - left the catch debug ones

Remember to sleep(1000) after every writeregisters to save on lots of heartache!!!
*/

const PLUGIN_ID = 'srne-to-signalk';
const _ = require("lodash");
var ModbusRTU = require("modbus-serial");

module.exports = function(app) {
  const plugin = {};
  let onStop = []

  var getDelta = require('./parser.js');

  plugin.id = PLUGIN_ID
  plugin.name = "SRNE MPPT Manager & Logger"
  plugin.description = "SignalK node server plugin that reads data from and controls one or more ML24xx MPPT Charger(s)"

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  plugin.start = function(options, restartPlugin) {


    const timeout = 			        900;

    const eepromBaseAddr =		      	0xe001;
    const absVoltAddr = 		        0xe008;
    const load_on_offAddr = 		    	0x010a;
    const readAddress = 		        0x0100;  //dynamic information

    const batteryCapacity=		      	options.batteryCapacity;
    const tailCurrent = 		        options.tailCurrent;
    const tailDuration = 		        options.tailDuration * 60;
    const batteryAbsVoltage = 			options.batteryAbsVoltage;
    const floatResetVoltage = 		  	options.floatResetVoltage;

    const systemVoltage = 		      	3084;
    const batteryType = 		        0;
    const overVoltageThreshold = 	  	155;
    const chargingVoltageLimit = 	  	155;
    const overDischargeRecVoltage = 		126;
    const underVoltageWarning = 	  	123;
    const overDischargeVoltage = 	  	112;
    const dischargeLimitVoltage = 		110;
    const SoCValue = 			        25650;
    const overDischargeTimeDelay = 		5; //seconds
    const tempComp = 			        0;

    const battStateCheckInterval = 		120000;

    var maxReadErrCnt = 		        10;


    var inFloatMode =             		false;
    var tailCurrentTotal = 		      	0;
    var tailCurrentAve =            		0;
    var tailVoltageTotal = 		      	0;
    var tailVoltageAve =            		0;

    arrSize =                       		tailDuration; // assumes 1s sample interval
    currentArr =                    		[];
    voltageArr =                    		[];

    plugin.clientList =             		[];

    let devices = options.devices
    devices.forEach(device => {
      const client = 			        new ModbusRTU();
      const ttyId = 			        device.ttyId;
      const ttyDevice = 		        device.ttyDevice;
      const equalisationVoltage =  		device.equalisationVoltage;
      const absorptionVoltage =    		device.absorptionVoltage;
      const floatVoltage = 		      	device.floatVoltage;
      const bulkRecVoltage = 		    	device.recoveryVoltage;
      const equalisationTime = 		  	device.equalisationTime;
      const absorptionTime = 		    	device.absorptionTime;
      const equalisationInterval = 		device.equalisationInterval;
      const tempFanOn = 		        device.fanTempOn + 273.15;
      const tempFanOff = 		        device.fanTempOff + 273.15;
      var temperature = 		        null;
      var settingsState = 		      	null;
      var fanState = 			        false;
      var errCnt =                  		0;
      var readIntervalId = 		      	null;
      var mpptSettingsArr =		      	[ 0, batteryCapacity, systemVoltage, batteryType, overVoltageThreshold,
                      			        chargingVoltageLimit, device.equalisationVoltage, device.absorptionVoltage, device.floatVoltage,
                       			        device.recoveryVoltage, overDischargeRecVoltage, underVoltageWarning, overDischargeVoltage,
                       			        dischargeLimitVoltage, SoCValue, overDischargeTimeDelay, device.equalisationTime,
                       			        device.absorptionTime, device.equalisationInterval, tempComp ];

// need to have a good look at this (above and below). What is redundant and what might be invalid ...
      plugin.clientList.push({client, ttyId, ttyDevice,
                                    equalisationVoltage, absorptionVoltage, floatVoltage, bulkRecVoltage,
                                    equalisationTime, absorptionTime, equalisationInterval, tempFanOn, tempFanOff, fanState, errCnt,
                                    temperature, settingsState, readIntervalId, mpptSettingsArr})
    }) //devices.forEach ...

    sleep(2000) // give the usb ports time to be setup by server/os
      .then(function() {
        plugin.clientList.forEach(controller => {
          setupController(controller)
          .then(function() {
            battCheckIntervalId = setInterval(function() {

              // should never be in float if Voltage is above Abs threshold except when other chargers are controlling
              // the battery voltage in which case we need to keep trying to set to float by making this variable false
              if ( (inFloatMode) && (tailVoltageAve > batteryAbsVoltage) )
                inFloatMode = false;

              if ( (!inFloatMode) && (tailVoltageAve > batteryAbsVoltage) && (tailCurrentAve < tailCurrent) ) {
                plugin.clientList.forEach(controller => {setControllerVoltage(controller, controller.floatVoltage)})
                inFloatMode = true;
              }

              if ( (inFloatMode) && (tailVoltageAve <= floatResetVoltage) ) {
                plugin.clientList.forEach(item => {setControllerVoltage(controller, controller.absorptionVoltage)})
                inFloatMode = false;
              }
            }, battStateCheckInterval)
          })  //.then
        })  //plugin.clientlist
      })  //.then

    function setupController(controller) {
       return new Promise(function(resolve, reject) {
            app.debug("Connecting to " + controller.ttyDevice)
            controller.settingsState = false;
            controller.client.connectRTUBuffered(controller.ttyDevice, { baudRate : 9600 })
              .then(function() {
                controller.client.setID(1)
                controller.client.setTimeout(timeout)
                app.debug("Connected to " + controller.ttyId)
               })
              .then(function() {
                readControllerState(controller)  // sets item.settingsState = true or false
                .then(function() {
                  if (controller.settingsState == false) {
                    updateController(controller)
                    .catch(function (e) {
                      app.debug("Error in updateController function, check the settings for " + controller.ttyId )
                      reject(e)
                    })
                  }
                  else {
                   app.debug("No update required on " + controller.ttyId)
                  }
                }) // .then
                .then(function() {
		    setControllerVoltage(controller, controller.absorptionVoltage)
                    sleep(1000)
                    .then(function() {
                      startReading(controller)
                      resolve()
                    })
                })
                .catch(function(e) {
                  app.debug("Error in readControllerState function, resetting controller " + controller.ttyId)
                  app.setPluginError("Resetting " + controller.ttyId + " for error " + e.message)
                  resetController(controller)
                })
              })
              .catch(function(e) {
                app.setPluginError(controller.ttyId + " ConnectRTU failed " + e.message)
                app.debug(controller.ttyId + " ConnectRTU failed " + e.message)
                resetController(controller)
              })
          resolve()
       }) // return promise
    } //function setupControllers

    function updateController(controller) {
      return new Promise(function(resolve, reject) {
        app.debug("About to update settings on " + controller.ttyId  )
        controller.client.writeRegisters(eepromBaseAddr, controller.mpptSettingsArr)
          .then(function() {
            app.debug( "Settings updated on " + controller.ttyId )
            app.setPluginStatus( "Settings updated on " + controller.ttyId )
            inFloatMode = false;
            sleep(1000)
            .then(function() { resolve() } )
          }) //.then
          .catch(function(e) {
            app.setPluginError(controller.ttyId + " updateController " + e.message)
            app.debug(controller.ttyId + " updateController " + e.message)
            reject(e)
          }) //catch
      }) // new Promise
    }

    function setControllerVoltage(controller, voltage) {
      return new Promise(function(resolve, reject) {
        stopReading(controller)
        .then(function() {
          controller.client.writeRegisters(absVoltAddr, [voltage, voltage])
            .then(function() {
              app.debug( "Voltage set on " + controller.ttyId + " to " + voltage)
              app.setPluginStatus( "Voltage set on " + controller.ttyId + " to " + voltage)
              sleep(1000)
              .then(function() {
                startReading(controller)
                resolve()
              })
            }) //.then
            .catch(function(e) {
              app.setPluginError(controller.ttyId + " setControllerVoltage error: " + e.message)
              app.debug(controller.ttyId + " setControllerVoltage error: " + e.message)
              startReading(controller)
              reject(e)
            }) //catch
          })
      }) // new Promise
    } // function

    function readControllerState(controller) { // false when the controllersettings don't match user settings
      return new Promise(function (resolve, reject) {
        app.debug("Reading settings from " + controller.ttyId)
        controller.settingsState = true
        controller.client.readHoldingRegisters(eepromBaseAddr, controller.mpptSettingsArr.length)
          .then(function(d) {
            var itr = 0
            while ( (itr < controller.mpptSettingsArr.length) && (d !== null) ) {
              if ( d.data[itr] != controller.mpptSettingsArr[itr] ) { controller.settingsState = false } // are settings current?
                itr++
            } // while
            resolve()
          }) //.then
          .catch(function(e) {
            app.setPluginError("Error in readHoldingRegisters " + controller.ttyId + " " +  e.message)
            app.debug("Error in readHoldingRegisters " + controller.ttyId + " " + e.message)
            reject(e)
          }) //.catch
      }) // new promise
    }  //readControllerState

    function resetController(controller) {
      return new Promise(function(resolve) {
        controller.errCnt = 0
        app.debug("controller reset - " + controller.ttyId)
        stopReading(controller) // includes delay
        .then(function() {
          controller.client.close()
          setupController(controller)
          resolve()
        })
      })
    }

    function stopReading(controller) {
      return new Promise(function(resolve) {
        if (controller.readIntervalId != null)
          clearInterval(controller.readIntervalId); // stop the read events
//        app.debug("Reading suspended for " + item.ttyId)
        sleep(1000)
        .then(function() { resolve() } )
      })
    }

    function startReading(controller) {
      // Read the data from the controller (registers) every second
      // First make sure one doesn't already exist
        if (controller.readIntervalId != null)
          clearInterval(controller.readIntervalId);

      return new Promise(function(resolve) {
        controller.readIntervalId = setInterval(function() {
            controller.client.readHoldingRegisters(readAddress, 33)
              .then(function(data) {
                if ( (data  != undefined ) && (data  != null) ) {
                    var delta = getDelta(data, controller.ttyId)
                    app.setPluginStatus("Reading MPPT Data")
                    controller.errCnt = 0
                    app.handleMessage(PLUGIN_ID, delta)
                } // if
              }) // .then(function(data) ...
              .catch(function(e) {
                ++controller.errCnt
                app.setPluginError(e.message + " " + controller.ttyId +  " in main readHoldingRegisters" )
                app.debug(e.message + " " + controller.ttyId +  " in main readHoldingRegisters" )
                if( controller.errCnt > maxReadErrCnt) {
                  resetController(controller)
                }
              })
              resolve()
        }, 1000) // readIntervalID
      }) // new Promise
    } //startReading

    // define the chargerTemp delta to be returned by the subs manager
    let mppt_Info = {
      context: "vessels.self",
      subscribe: [{
       path: `electrical.chargers.mppt*`,
        period: 5000
      }]
    }

    app.subscriptionmanager.subscribe ( mppt_Info, onStop, subscription_error, delta => {
      plugin.clientList.forEach ( item => {
        const ttyId = item.ttyId
        delta.updates.forEach ( update => {
          update.values.forEach ( value => {
            const path = value.path
            const val = value.value
              if ( path.endsWith (ttyId + '.charger.temperature') || path.endsWith (ttyId + '.load.on_off')  ) {
               // dont want this to run for every delta - only the ones we are interesting in
                if ( path.endsWith ( ttyId + '.charger.temperature' ) ) { item.temperature = val }
                if ( path.endsWith ( ttyId + '.load.on_off' ) ) {
                  item.fanState = val
                  if ( (item.temperature >= item.tempFanOn) &&  (item.fanState == 0 ) ) { switchFans(item, 1) }
                  if ( (item.temperature <= item.tempFanOff) &&  (item.fanState == 1 ) ) { switchFans(item, 0) }
                }
              } // if path.endsWith ....
          }) // update.values ...
        }) // delta.updates ...
      }) //plugin.clientList.forEach(device ...
    })  //subsmanager


    let batt_Info = {
      context: "vessels.self",
      subscribe: [{
        path: `electrical.batteries.House*`,
        period: 1000
      }]
    }

    app.subscriptionmanager.subscribe ( batt_Info, onStop, subscription_error, delta => {
        // update the arrays here
        delta.updates.forEach ( update => {
          update.values.forEach ( value => {
            const path = value.path
            const val = value.value
            if ( path.endsWith ('.current') || path.endsWith ('.voltage')  ) {
            // dont want this to run for every delta - only the ones we are interesting in
              if ( path.endsWith ('.current' ) ) {
                //  add to current array
                currentArr.unshift(val)
                tailCurrentTotal += val
                if (currentArr.length > arrSize) {
                  tailCurrentTotal -= currentArr[arrSize - 1]
                  currentArr.pop()
                }
                tailCurrentAve = (tailCurrentTotal / currentArr.length)
              }

              if ( path.endsWith ('.voltage' ) ) {
                // add to voltage array
                voltageArr.unshift(val)
                tailVoltageTotal += val
                if (voltageArr.length > arrSize) {
                  tailVoltageTotal -= voltageArr[arrSize - 1]
                  voltageArr.pop()
                }
                tailVoltageAve = (tailVoltageTotal / voltageArr.length)
              }

            } // if path.endsWith ....
          }) // update.values ...
        }) // delta.updates ...
    })  //subsmanager

    function switchFans(item, on_off) {
      return new Promise( function(resolve, reject) {
//        app.debug("Switch fans routine called - " + item.ttyId)
        stopReading(item)
        .then( function () {
          app.debug( "Fan switched to " + on_off + " on "+ item.ttyId )
          item.client.writeRegister( load_on_offAddr, on_off)
            .catch(function(e) {
              app.debug(e.message + " " + item.ttyId + " from switchFans()" )
              app.setPluginError(e.message + " " + item.ttyId +  " from switchFans()" )
            })
          }) // .then(function() ...
        .then(function() {
          startReading(item)
          resolve()
        })
      })
    };

    function sleep(duration) {
//      app.debug("Sleeping for " + duration + "ms")
      return new Promise(function(resolve) {
          setTimeout(function() {
              resolve();
          }, duration);
      });
    }


  }; //plugin start

/////////////////////////////////////////////////////////////////////////////////////////////////////////
  plugin.stop = function() {

    plugin.clientList.forEach(function(item) {
      clearInterval(item.readIntervalId); // stop the read events
      if (item.client.isOpen) { item.client.close() } // close the serial ports
    })

    clearInterval(battCheckIntervalId);

    onStop.forEach(f => f());
    onStop = [];
    app.setPluginStatus("Plugin stopped.");
  }

///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  plugin.schema = {
    type: "object",
    properties: {

      batteryCapacity: {
        type: 'number',
        title: 'Nominal battery capacity (Ah)',
	      description: 'This is the nominal battery capacity of the bank',
        default: 1260},

      batteryAbsVoltage: {
        type: 'number',
        title: 'Battery absorption voltage (V)',
	      description: 'This is the voltage at which the batteries are considered to be in the absorption phase',
        default: 14.3},

      tailCurrent: {
      	type: 'number',
	      title: 'Tail Current (A)',
	      description: 'This is the target current which determines the float state of the batteries',
	      default: 6.3},

      tailDuration: {
      	type: 'number',
	      title: 'Tail Current Duration (minutes)',
	      description: 'This is the duration (in minutes) for which the Tail Current must be satisfied before the absorption voltages are set to float',
	      default: 5},

      floatResetVoltage: {
        type: 'number',
        title: 'Float reset voltage (V)',
        description: 'This is the battery voltage below which the Absorption voltage setting is reset back to Absorption from Float voltage)',
        default: 12.6
      },

      devices: {
        type: 'array',
        title: 'Connected Devices',

        items: {
          type: 'object',
          properties: {
            ttyDevice: {
              type: 'string',
              title: 'Serial Port',
              default: '/dev/ttyOP_x'
            },
            ttyId: {
              type: 'string',
              title: 'MPPT Identifier',
              description: 'This is used to identify the MPPT Controller',
              default: 'mppt1'
            },
	    equalisationVoltage: {
      	      type: 'number',
              title: 'Equalisation Voltage (V x10)',
	      description: 'This is the Equalisation Charge Voltage setting',
              default: 154
            },
	    absorptionVoltage: {
              type: 'number',
              title: 'Absorption Voltage (V x10)',
              description: 'This is the Absorption Charge Voltage setting',
              default: 141
            },
	    floatVoltage: {
              type: 'number',
              title: 'Float Voltage (V x10)',
              description: 'This is the Float Charge Voltage setting',
              default: 136
            },
  	    recoveryVoltage: {
              type: 'number',
              title: 'Bulk Recovery Voltage (V x10)',
              description: 'This is the voltage threshold below which the charger reverts to Bulk Charging mode',
              default: 127
            },
      	    equalisationInterval: {
              type: 'number',
              title: 'Equalisation Interval (days 0-255)',
	      description: 'This is the Equalisation Charge Interval setting',
              default: 0
 	    },
 	    equalisationTime: {
              type: 'number',
              title: 'Equalisation Charge Duration (minutes 0-300)',
	      description: 'This is the Equalisation Charge duration setting',
              default: 0
	    },
 	    absorptionTime: {
              type: 'number',
              title: 'Absorption Charge Duration (minutes 10-300)',
	      description: 'This is the Absorption Charge Duration timer setting',
              default: 300
            },
	    fanTempOn: {
	      type: 'number',
	      title: 'Fan Temp. On (C)',
	      description: 'This is the temperature at which the fan switches on',
	      default: 38
	    },
   	    fanTempOff: {
	      type: 'number',
	      title: 'Fan Temp. Off (C)',
	      description: 'This is the temperature at which the fan switches off',
	      default: 37
	    }
          }  //properties
        }  //items
      } //devices
    }
  }

  function subscription_error(err) {
    app.setPluginError(err)
  }

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  return plugin;
}
