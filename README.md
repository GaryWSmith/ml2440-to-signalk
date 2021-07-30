# SRNE ML2440 to signalk
Signalk plugin to parse data from the SRNE MPPT solar controllers
Tested on the ML2440 device but should work on all SRNE MPPT controllers which use MODBUS-Serial comms.

It reads only selected values. 

The controller parameters are set from the plugin config variables.

It now also controls the "load ouptut" of the controllers to which cooling fans are connected.

It also adds intelligence to the charging as it sets the absorption voltage and float voltage settings to the desired float voltage when the batteries have reached the fully charged condition i.e. when the battery voltage reaches the usewr set voltage and current drops to below the the users set tail current value. 

Currently a timer is set when the conditions are first satisfied. At the end of the timer duration (user configurable) the absorption voltage is reduced to the float value. 

This functionality is only possible because the voltage and current measurements are available within the Signalk server. 

See parser.js and the attached modbus interface document.

