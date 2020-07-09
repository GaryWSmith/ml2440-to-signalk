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
  This version adjusts voltage rather than relying on the Absorption timer of the controller
  The absorption timer is not producing the expected results i.e. the controller does not shift into
  float mode after n minutes in absorption ...
*/


const PLUGIN_ID = 'srne-to-signalk';
const _ = require("lodash");
var ModbusRTU = require("modbus-serial");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = function(app) {
  const plugin = {};
  let onStop = []

  var getDelta = require('./parser.js');

  plugin.id = PLUGIN_ID
  plugin.name = "SRNE MPPT Manager & Logger"
  plugin.description = "SignalK node server plugin that reads data from one or more ML2440 MPPT Charger(s)"

  plugin.schema = {
    type: "object",
    properties: {

      batteryCapacity: {
        type: 'number',
        title: 'Nominal battery capacity (Ah)',
	description: 'This is the nominal battery capacity of the bank',
        default: 630},

      equalisationVoltage: {
        type: 'number',
        title: 'Equalisation voltage (V x10)',
	description: 'This is the equalisation charge voltage setting',
        default: 154},

      absorptionVoltage: {
        type: 'number',
        title: 'Absorption voltage (V x10)',
        description: 'This is the absorption charge voltage setting',
        default: 141},

      floatVoltage: {
        type: 'number',
        title: 'Float voltage (V x10)',
	description: 'This is the float charge voltage setting',
        default: 131},

      recoveryVoltage: {
        type: 'number',
        title: 'Bulk recovery voltage (V x10)',
	description: 'This is the voltage at which charging reverts to bulk charging mode',
        default: 139},

      voltDrop: {
        type: 'number',
        title: 'Voltage Drop (V)',
	description: 'This is the voltage drop between the chargers and batteries',
        default: 0.2},

      equalisationInterval: {
        type: 'number',
        title: 'Equalisation interval (days 0-255)',
	description: 'This is the equalisation charge interval setting',
        default: 0},

      equalisationTime: {
        type: 'number',
        title: 'Equalisation charge time (minutes 0-300)',
	description: 'This is the equalisation charge time setting',
        default: 0},

      absorptionTime: {
        type: 'number',
        title: 'Absorption charge timer (minutes 10-300)',
	description: 'This is the absorption charge timer setting',
        default: 300},

      floatResetVoltage: {
        type: 'number',
        title: 'The float reset voltage (x10)',
	description: 'This is the voltage below which the float condition is reset. (Absorption to voltage above)',
        default: 128},

      tailCurrent: {
	type: 'number',
	title: 'Tail Current (A)',
	description: 'This is the target current at which the absorption charge timer is set to minimum (10 min)',
	default: 3.15},

      tailDuration: {
	type: 'number',
	title: 'Tail Current Duration (minutes)',
	description: 'This is the duration for which the Tail current must be satisfied before the absorption timer is reset to 10min',
	default: 5},

      fanTempOn: {
	type: 'number',
	title: 'Fan temp on (C)',
	description: 'This is the temperature at which the fan switches on',
	default: 36},

      fanTempOff: {
	type: 'number',
	title: 'Fan temp off (C)',
	description: 'This is the temperature at which the fan switches off',
	default: 35},

      devices: {
        type: 'array',
        title: 'Connected Devices',
        items: {
          type: 'object',
          properties: {
            ttyDevice: {
              type: 'string',
              title: 'Serial Device Name',
              default: '/dev/ttyOP_x'
            },
            ttyId: {
              type: 'string',
              title: 'MPPT Identifier',
              description: 'This is used to identify the MPPT Controller',
              default: 'mppt1'
            }
          }
        }
      }
    }
  }

  function waitAwhile ()
  {
      sleep(1000)
        .then(app.setProviderStatus("Just a little delay to allow any reads to complete") )
  }


  function subscription_error(err)
  {
    app.setProviderError(err)
  }



  plugin.start = function(options) {

    const eepromBaseAddr =		0xe001;
    const absVoltAddr = 		0xe008;
    const load_on_offAddr = 		0x010a;
    const readAddress = 		0x0100;  //dynamic information

    const batteryCapacity=		options.batteryCapacity;
    const systemVoltage = 		3084;
    const batteryType = 		0;
    const overVoltageThreshold = 	160;
    const chargingVoltageLimit = 	158;
    var equalisationVoltage =  		options.equalisationVoltage;
    var absorptionVoltage =    		options.absorptionVoltage;
    var floatVoltage = 			options.floatVoltage;
    var bulkRecVoltage = 		options.recoveryVoltage;
    const overDischargeRecVoltage = 	126;
    const underVoltageWarning = 	123;
    const overDischargeVoltage = 	112;
    const dischargeLimitVoltage = 	110;
    const SoCValue = 			25650;
    const overDischargeTimeDelay = 	5; //seconds
    var equalisationTime = 		options.equalisationTime;
    var absorptionTime = 		options.absorptionTime;
    var equalisationInterval = 		options.equalisationInterval;
    const tempComp = 			0;

    var tailCurrent = 			options.tailCurrent;
    var tailDuration = 			options.tailDuration * 60000;
    var floatResetVoltage = 		options.floatResetVoltage;
    var battVoltage = 			0.0;
    var battCurrent = 			0.0;
    var voltDrop = 			options.voltDrop;

    const battSubsInterval = 		10000;
    var tailTimer = 			0;

    var firstRun = 			true;
    var maxAbsVoltSet = 		true;
    const tempFanOn = 			(options.fanTempOn + 273);
    const tempFanOff = 			(options.fanTempOff + 273);

    settingsArr = [0, batteryCapacity, systemVoltage, batteryType, overVoltageThreshold, chargingVoltageLimit, equalisationVoltage,
                   absorptionVoltage, floatVoltage, bulkRecVoltage, overDischargeRecVoltage, underVoltageWarning,
                   overDischargeVoltage, dischargeLimitVoltage, SoCValue, overDischargeTimeDelay, equalisationTime,
                   absorptionTime, equalisationInterval, tempComp ]

    let devices
    if ( !options.devices && options.device ) {
      devices = [  {ttyId : "mppt1", ttyDevice: options.device}  ]
    }
    else devices = options.devices


    plugin.clientList = [];

    devices.forEach(device => {
      var temperature = null;
      var state = null;
      var ttyId = device.ttyId;
      var client = new ModbusRTU();
      client.connectRTUBuffered(device.ttyDevice, { baudRate : 9600 })
        .then( () => {
          client.setID(1);
          client.setTimeout(1000)

          var itr = 0;
          var allEqual = true;
          waitAwhile
          client.readHoldingRegisters(eepromBaseAddr, settingsArr.length)
    	    .catch( function(e) {
                app.setProviderError(ttyId + " " + e.message + " from `readHoldingRegisters`" )
                app.debug(ttyId + " " + e.message + " from `readHoldingRegisters`" )
                // need to take action ... but what?
             })
            .then(function(d) {
              while ( itr < settingsArr.length ) {
                if ( d.data[itr] != settingsArr[itr] ) { allEqual = false }
                itr++
              } // while
              if ( !allEqual ) {
		app.debug(ttyId + " Required settings : " + settingsArr)
                app.debug(ttyId + " Actual settings   : " + d.data)
                waitAwhile
                // write the initial settings to the controllers if required
                client.writeRegister(eepromBaseAddr, settingsArr)
                    .catch(function(e) {
                      app.setProviderError( e.message + " " + ttyId + " from write required settings" )
                      app.debug( e.message + " " + ttyId + " from write required settings" )
                      // need to take action ...
                    })
                    .then ( function() {
                      maxAbsVoltSet = true
  	              app.debug( ttyId + " controller set with required settings" )
   	              app.setProviderStatus( ttyId + " controller set with initial settings" )
                    })
              } // if( allEqual ...
	      else { app.debug(ttyId + " controller settings don't need updating") }
            }) // .then(function(data ...
           plugin.clientList.push({client, ttyId, temperature, state});
        }); // client.connectRTU .then ...
    }); //devices.forEach ...

    startReading()

// define the batteryInfo delta to be returned by the subs manager
      let batteryInfo = {
        context: "vessels.self",
        subscribe: [{
          path: `electrical.batteries.House.*`,
          period: battSubsInterval
        }]
      }

    debugSet = true // only for debugging

//  listen for the batteryInfo deltas ...
    app.subscriptionmanager.subscribe(batteryInfo, onStop, subscription_error, delta => {
       delta.updates.forEach(update => {
         update.values.forEach(value => {
           const path = value.path

           if ( path.endsWith('current') || path.endsWith('voltage') ) {  // only interested in these two deltas
             if ( path.endsWith('current') ) { battCurrent = value.value }
             if ( path.endsWith('voltage') ) { battVoltage = value.value }

             // if battVoltage drops below specified reset voltage then the AbsVoltage needs to be reset for full abs voltage ...
	     if ( (battVoltage * 10) < (floatResetVoltage) ) {
                 if ( debugSet ) {
                   app.debug("battVoltage is below : " + floatResetVoltage.toString() )
                   app.debug("maxAbsVoltSet = " + maxAbsVoltSet.toString() )
                   debugSet = false
                 }
	         if ( !maxAbsVoltSet ) {
		     app.debug("about to set absorption voltage to " + absorptionVoltage.toString() )
                     clearInterval(plugin.readIntervalId); // stop the read interval trigger
                     waitAwhile // allow any current reads to finish
  	             plugin.clientList.forEach(element => {
                         element.client.writeRegister(absVoltAddr, absorptionVoltage)
      		    	     .catch( function(e) {
                               app.setProviderError( e.message + " " + element + " from write full absorption voltage" )
                               app.debug( e.message + " " + element + " write full absorption voltage" )
                               // need to take action
                             })
			     .then( function() {
                               app.debug( element + " controllers absorption volatge set to " + absorptionVoltage.toString() )
			       app.setProviderStatus(element + " controllers absorption voltage set to " + absorptionVoltage.toString() )
			       maxAbsVoltSet = true
                             })
                     }) //plugin.clientList ...
                     plugin.timerId = null // allow for the float timer to be set again
                     startReading // start the readInterval again.
	         } // if (maxAbsVoltSet ...
              } //if ((battVoltage ...

// debug only !!!!
//tailCurrent = 13; tailDuration = 20000;

             if ( ( ( (battVoltage + voltDrop)*10 )  >= absorptionVoltage) && (battCurrent <= tailCurrent) && (battCurrent > 0) ) {
               //  battery voltages are in float condition - start timer.
	       if ( (plugin.timerId == undefined) || (plugin.timerId == null) ){
                 plugin.timerId = setTimeout(writeReducedAbsVoltage, tailDuration)
                 app.debug( "Float timer set" )
                 app.debug( "Battery voltage = " + ((battVoltage + voltDrop)*10).toString() )
                 app.debug( "Abs voltage = " + absorptionVoltage.toString() )
                 app.debug( "Battery current = " + batteryCurrent.toString() )
                 app.debug( "tailCurrent = " + tailCurrent.toString() )
	       } // if ((plugin.timerId
             } // if battVoltage >= absorptionVolt...
            } // if path.endsWith ...
          }) // delta.values
       }) // delta.updates.
    }) //battInfo subsmanager


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
                item.state = val
                if ( (item.temperature >= tempFanOn) &&  (item.state == 0 ) ) { switchFans(item, 1) }
                if ( (item.temperature <= tempFanOff) && (item.state == 1 ) ) { switchFans(item, 0) }
              }
            } // if path.endsWith ....
          }) // update.values ...
        }) // delta.updates ...
      }) //devices.forEach(device ...
    })  //subsmanager


    function switchFans(item, on_off) {
      clearInterval(plugin.readIntervalId); // stop the read events
      waitAwhile // allow any current reads to finish
      item.client.writeRegister( load_on_offAddr, on_off)
        .catch(function(e) { app.setProviderError(e.message + " " + item.ttyId +  " from switchFans()" ); })
	.then( function () {
          app.setProviderStatus( item.ttyId + " fan switched " + on_off.toString() )
	  app.debug( item.ttyId + " fan switched " + on_off.toString() )
        }) // .then(function() ...
        startReading() // start the readInterval again.
    }


    function startReading(){
      // Read the data from the controller (registers) every second
      plugin.readIntervalId = setInterval(function() {
        plugin.clientList.forEach(function({client, ttyId}) {
          client.readHoldingRegisters(readAddress, 33)
            .catch(function(e) {
              app.setProviderError(e.message + " " + ttyId +  " from main readHoldingRegisters" )
              app.debug(e.message + " " + ttyId + " from main readHoldingRegisters" )
            })
            .then(function(data) {
              if ( ( data != undefined ) && (data != null) ) { var delta = getDelta(data, ttyId) }
              if ( ( delta != null) && (delta != undefined) ) {
                if (firstRun) { app.setProviderStatus("Processing MPPT Data") }
                app.handleMessage(PLUGIN_ID, delta)
                firstRun = false
              }
            }) // ..then(function(data) ...
        }) //plugin.clientList.forEach
      }, 1000); //readIntervalID
    }


    function writeReducedAbsVoltage()
    {
      if ( maxAbsVoltSet ) {
	  // floatVoltage is not already set i.e.  (!maxAbsVoltSet)
	  app.debug( "about to reduce absorption volatge to float value" )
          clearInterval( plugin.readIntervalId ); // stop the read interval trigger
          waitAwhile // allow any current/pending reads to finish
  	  plugin.clientList.forEach(element => {
            element.client.writeRegister(absVoltAddr, floatVoltage)
	      .then( function () {
                app.debug(element.ttyId + element.ttyId + " controllers absorption voltage set to " + floatVoltage.toString() )
                app.setProviderStatus(element.ttyId + " controllers absorption voltage set to " + floatVoltage.toString() )
	        maxAbsVoltSet = false
              })
      	      .catch( function(e) {
                app.setProviderError( e.message + " " + element.ttyId + " from writeReducedAbsVoltage" )
                app.debug( e.message + " " + element.ttyId + " from writeReducedAbsVoltage" )
              })
          }) //plugin.clientList ...
	startReading() // start the readInterval again.
      } // if maxAbsVoltSet...
    }


  }; //plugin.start


  plugin.stop = function() {
    clearInterval(plugin.readIntervalId);
    plugin.clientList.forEach(function({client, ttyID}) {
      if (client.isOpen) {
	   client.close();
      }
    });

    onStop.forEach(f => f());
    onStop = [];
    app.setProviderStatus("Plugin stopped.");
    app.debug('Plugin stopped');
  }

  return plugin;
}
