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

const PLUGIN_ID = 'ml2440-to-signalk';
const _ = require("lodash");
var ModbusRTU = require("modbus-serial");

module.exports = function(app) {
  var plugin = {
  };

  var getDelta = require('./parser.js');

  plugin.id = PLUGIN_ID
  plugin.name = "ML2440 MPPT Reader"
  plugin.description = "SignalK node server plugin that reads data from one or more ML2440 MPPT Charger(s)"

  let readAddress = 0x0100

  plugin.schema = {
    type: "object",
    properties: {
      devices: {
        type: 'array',
        title: 'Devices',
        items: {
          type: 'object',
          properties: {
            ttyDevice: {
              type: "string",
              title: "Serial Device Name",
              default: "/dev/ttyOP_x"
            },
            ttyId: {
              type: "string",
              title: "MPPT Identifier",
              description: "This is used to identify the MPPT Controller",
              default: "mppt1"
            }
          }
        }
      }
    }
  }

  plugin.start = function(options) {
    let devices
    if ( !options.devices && options.device ) {
      devices = [  {ttyId : "mppt1", ttyDevice: options.device}  ]
    } else {
      devices = options.devices
    }


    plugin.clientList = [];
    devices.forEach(device => {
      var client = new ModbusRTU();
      client.connectRTUBuffered(device.ttyDevice, { baudRate: 9600 });
      client.setID(1);
      var ttyId = device.ttyId;
      plugin.clientList.push({client, ttyId});
    })

    plugin.intervalId = setInterval(function() {
      plugin.clientList.forEach(function({client, ttyId})  {
        client.readHoldingRegisters(readAddress, 33, function(err, data) {
        if (err){
	   app.debug(err);
           app.setProviderError(err.message);
	   app.setProviderStatus("Error detected");
//           plugin.stop();
        } else {
            var delta = getDelta(data, ttyId);
            if (delta != null){
//             app.debug(JSON.stringify(delta));
               app.handleMessage(PLUGIN_ID, delta);
               app.setProviderStatus("Processing MPPT Data");
            }
          }
       });
      });
    }, 1000);
    app.debug('Plugin started');
//    app.setProviderError("Don't be pessimistic :-)");
    app.setProviderStatus("Processing MPPT Data.");
  }


  plugin.stop = function() {
    clearInterval(plugin.intervalId);
    plugin.clientList.forEach(function({client, ttyID}) {
      if (client.isOpen) {
	   client.close()
      }
    });
    app.setProviderStatus("Plugin stopped.");
    app.debug('Plugin stopped');
  }
  return plugin
}
