const ENABLE_SHT3x = false
const ENABLE_DPS310 = true
const http = require('http');
const i2c = require('i2c-bus')
const DEVICE_NUMBER = 1
const i2c1 = i2c.openSync(DEVICE_NUMBER)

// general
let timestamp = undefined;

// SHT-3x
let SHT3x_temp = undefined;
let SHT3x_humid = undefined;
let SHT3x_readBuf = new Buffer.alloc(0x10);

const i2c_SHT3x_ADDR = 0x45
if (ENABLE_SHT3x) {
    // See page 11 https://www.mouser.com/datasheet/2/682/Sensirion_Humidity_Sensors_SHT3x_Datasheet_digital-971521.pdf
    i2c1.writeByteSync(i2c_SHT3x_ADDR, 0x21, 0x30)
}

// dps310
let dps_temp = undefined;
let dps_pressure = undefined;
let dps310_readBuf = new Buffer.alloc(0x20);
let dps310_readBuf2 = new Buffer.alloc(0x20);
const i2c_DPS310_ADDR = 0x77
const dps_scale_factor = [524288, 1572864, 3670016, 7864320, 253952, 5160096, 1040384, 2088960]
const DPS310_pressure_measurement_rate = 2 // (1 << DPS310_pressure_measurement_rate) measurements/sec 0~7
const DPS310_pressure_oversampling_rate = 6 // (1 << DPS310_pressure_oversampling_rate) times 0~7
const DPS310_temperature_measurement_rate = 2 // (1 << DPS310_temperature_measurement_rate) measurements/sec 0~7
const DPS310_temperature_oversampling_rate = 6 // (1 << DPS310_temperature_oversampling_rate) times 0~7
const DPS310_temperature_sensor_is_external = 1 // 0 or 1
if (ENABLE_DPS310) {
    // See https://www.infineon.com/dgdl/Infineon-DPS310-DS-v01_00-EN.pdf?fileId=5546d462576f34750157750826c42242
    i2c1.writeByteSync(i2c_DPS310_ADDR, 0x06, (DPS310_pressure_measurement_rate << 4) + DPS310_pressure_oversampling_rate)
    i2c1.writeByteSync(i2c_DPS310_ADDR, 0x07, (DPS310_temperature_sensor_is_external << 7) + (DPS310_temperature_measurement_rate << 4) + DPS310_temperature_oversampling_rate )
    // Background Mode, Continous pressure and temperature measurement
    i2c1.writeByteSync(i2c_DPS310_ADDR, 0x08, 0x07)
    // Temperature, Pressure result bit-shift
    i2c1.writeByteSync(i2c_DPS310_ADDR, 0x09, 0x0C)
}

setInterval(function(){
    if (ENABLE_SHT3x){
        try{
            i2c1.writeByteSync(i2c_SHT3x_ADDR, 0xE0, 0x00);
            i2c1.i2cReadSync(i2c_SHT3x_ADDR, 6, SHT3x_readBuf );
            SHT3x_temp = (-45 + SHT3x_readBuf.readUInt16BE(0) * 175 / 65535)
            SHT3x_humid = ( SHT3x_readBuf.readUInt16BE(3) * 100 / 65535)
            console.log(SHT3x_temp, SHT3x_humid, SHT3x_readBuf)
        }catch(e){
            console.warn(e, new Date())
        }
    }
    if (ENABLE_DPS310) {
        let temp_raw = undefined;
        let pres_raw = undefined;

        let c0, c1, c00, c10, c01, c11, c20, c21, c30, temp_raw_sc, pres_raw_sc
        try{
            i2c1.readI2cBlockSync(i2c_DPS310_ADDR, 0x00, 0x20, dps310_readBuf)
            i2c1.readI2cBlockSync(i2c_DPS310_ADDR, 0x20, 0x20, dps310_readBuf2)
            pres_raw = (dps310_readBuf.readInt16BE(0) << 8) + dps310_readBuf.readUInt8(2)
            temp_raw = (dps310_readBuf.readInt16BE(3) << 8) + dps310_readBuf.readUInt8(5)
            // calibration coefficients
            c0 = dps310_readBuf.readInt16BE(0x10) >> 4
            c1 = dps310_readBuf.readUInt16BE(0x11) & 0x0fff
            if (c1 & (1 << 11)) c1 -= 1 << 12
            c00 = dps310_readBuf.readInt32BE(0x13) >> 12
            c10 = (dps310_readBuf.readUInt32BE(0x15) & 0x0fffff00) >> 8
            if (c10 & (1<<19)) c10 -= 1 << 20
            c01 = dps310_readBuf.readInt16BE(0x18)
            c11 = dps310_readBuf.readInt16BE(0x1A)
            c20 = dps310_readBuf.readInt16BE(0x1C)
            c21 = dps310_readBuf.readInt16BE(0x1E)
            c30 = dps310_readBuf2.readInt16BE(0x00)
            temp_raw_sc = temp_raw / dps_scale_factor[DPS310_temperature_oversampling_rate]
            pres_raw_sc = pres_raw / dps_scale_factor[DPS310_pressure_oversampling_rate]
            dps_temp = c0 * .5 + c1 * temp_raw_sc
            dps_pressure = c00 + pres_raw_sc * (c10 + pres_raw_sc * (c20 + pres_raw_sc * c30)) + temp_raw_sc * c01 + temp_raw_sc * pres_raw_sc * (c11 + pres_raw_sc * c21)
            console.log(dps_temp, dps_pressure)
        }catch(e){
            console.warn(e, new Date())
        }
    }

    timestamp = +new Date();
}, 1000);

const svr = http.createServer(function( req, res) {

    res.writeHead(200, {'Content-Type': 'text/plain'});
    let res_arr = []
       
    if (ENABLE_SHT3x){
        res_arr.concat(
            ['#HELP home_temperature 気温',
            '#TYPE home_temperature gauge',
            '#HELP home_humidity 湿度',
            '#TYPE home_humidity gauge'
            ]
        )
        const name = 'SHT35-2019'
        const d = {
            humid: SHT3x_humid, temp: SHT3x_temp, timestamp, name
        }
        res_arr.push(`home_temperature{device="${d.name}"} ${d.temp} ${d.timestamp}`)
        res_arr.push(`home_humidity{device="${d.name}"} ${d.humid} ${d.timestamp}`)
    }

    if (ENABLE_DPS310) {
        res_arr.concat(['#HELP home_pressure 気圧', '#TYPE home_pressure gauge'])
        res_arr.push(`home_pressure{device="DPS310"} ${dps_pressure} ${timestamp}`)
    }

    
    res.end(res_arr.map(l=>`${l}\n`).join(''))
		
});
svr.timeout = 10000;
svr.listen(8000);
