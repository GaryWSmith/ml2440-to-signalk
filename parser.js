/*
charging mode
00H deactivated
01H activated
02H mppt mode
03H equalising mode
04H boost mode
05H float mode
06H current limiting
*/

module.exports = function generateDelta(data, ttyId){
  let sourceObj = { "label": "MPPT-Reader", "type": "ModBus", "talker": "ModbusRTU", "sentence": "proprietary" };
  var skValArr = fillValueArr(data, ttyId);
  if (skValArr == null)
    return null;
  let updatesArr = [{ "source" : sourceObj, "values" : skValArr}];
  let skDeltaObj = {"updates" : updatesArr};
  return skDeltaObj;
};

function fillValueArr(data, ttyId){
  let prefix = "electrical.chargers." + ttyId;
  let valObjArr = [
    {"path" : prefix + ".charger.temperature", 			        "value" : ((data.data[3] & 32512) % 255) + 273},
    {"path" : prefix + ".battery.temperature", 			        "value" : (data.data[3] & 127) + 273},
    {"path" : prefix + ".chargingMode",  			              "value" : data.data[32] & 255},
    {"path" : prefix + ".panel.voltage", 			              "value" : data.data[7]/10},
    {"path" : prefix + ".panel.current",  			            "value" : data.data[8]/100},
    {"path" : prefix + ".panel.power",  			              "value" : data.data[9]},
    {"path" : prefix + ".battery.SoC" , 			              "value" : data.data[0]/100},
    {"path" : prefix + ".battery.voltage",  			          "value" : data.data[1]/10},
    {"path" : prefix + ".battery.current",  			          "value" : data.data[2]/100},
    {"path" : prefix + ".battery.dailyMinVoltage",	 	      "value" : data.data[11]/10},
    {"path" : prefix + ".battery.dailyMaxVoltage",		      "value" : data.data[12]/10},
    {"path" : prefix + ".battery.dailyMaxChargeCurrent",    "value" : data.data[13]/100},
    {"path" : prefix + ".battery.dailyMaxChargePower", 		  "value" : data.data[15]},
    {"path" : prefix + ".battery.dailyAccumulatedAmpHours",	"value" : data.data[17]},
    {"path" : prefix + ".battery.dailyAccumulatedPower", 	  "value" : data.data[19]},
    {"path" : prefix + ".load.on_off",  			              "value" : data.data[10]},
    {"path" : prefix + ".load.voltage", 			"value" : data.data[4]/10},
    {"path" : prefix + ".load.current",  			"value" : data.data[5]/100},
    {"path" : prefix + ".load.power",  				"value" : data.data[6]},
    {"path" : prefix + ".load.dailyMaxCurrent",			"value" : data.data[14]/100},
    {"path" : prefix + ".load.dailyMaxPower", 			"value" : data.data[16]},
    {"path" : prefix + ".load.dailyAmpHours", 			"value" : data.data[18]},
    {"path" : prefix + ".load.dailyAccumulatedPower", 		"value" : data.data[20]}
    ];
  return valObjArr;
};
