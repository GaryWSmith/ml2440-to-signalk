// The timing in this file works ...
// the use of the notReady variable should avoid asynchronous events
// clashing with the read & writes

var ModbusRTU = require("modbus-serial")
var client = new ModbusRTU()

var dObj = new Date()
var notReady = false

client.connectRTUBuffered("/dev/ttyOP_mppt2", {baudRate: 9600})
    .then(setClient)
    .catch(function(e) {
        console.log(e.message); })
    .then(function() {
        console.log("Connected"); })
    .then(writeFloatReg)

function setClient() {
    client.setID(1)
    client.setTimeout(1000)
}

function writeFloatReg() {
    notReady = true;
    console.log("About to write to regs " + dObj.getMinutes() + ":" + dObj.getSeconds() )
    client.writeRegisters(0xe009, [145, 145])
        .catch(function(e) {
            console.log(e.message); })
        .then(function(d) {
            console.log("Write to absorption regs at: " + dObj.getMinutes() + ":" + dObj.getSeconds(), d); })
        .then(notReady = false)
        .then(readFloatReg)
}

function readFloatReg() {
     notReady = true;
     client.readHoldingRegisters(0xe009, 2)
        .catch(function(e) {
            console.log(e.message); })
        .then(function(d) {
            console.log("Received at : " + dObj.getMinutes() + ":" + dObj.getSeconds(), d.data); })
        .then(close);
        .then(notReady = false);
}

function close() {
    client.close();
    console.log("client closed at " + dObj.getMinutes() + ":" + dObj.getSeconds() )
}

