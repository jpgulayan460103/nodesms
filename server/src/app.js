import express, { json } from 'express';
import path from 'path';
import { SerialPort } from 'serialport'

const app = express();

app.use(json())

const PORT = process.env.PORT || 8000;

app.use('/', express.static(path.join(`${__dirname}./../../client`, 'build')))

app.get('/', async (req, res) => {
    res.sendFile("index.html", {'root': './client/build'});
});

app.get('/send', async (req, res) => {

    // const Readline = require('@serialport/parser-readline');
    const { ReadlineParser } = require('@serialport/parser-readline')

    const port = new SerialPort({ path: 'COM5', baudRate: 9600 })
    const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
    
    res.sendFile("index.html", {'root': './client/build'});
});



app.get('/open', async (req, res) => {

    
    // const Readline = require('@serialport/parser-readline');
    const { ReadlineParser } = require('@serialport/parser-readline')

    const port = new SerialPort({ path: 'COM5', baudRate: 9600 })
    const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    port.on('open', () => {
        console.log('GSM modem is ready');

        const phoneNumber = '+639760371866'; // Replace with the recipient's phone number
        const message = 'Hello, this is a test SMS.'; // Replace with the SMS content

        const command = `AT+CMGS="${phoneNumber}"\r\n`;

        // port.write(command, (err) => {
        //     if (err) {
        //     console.error('Error sending command:', err);
        //     }
        //     console.log('message written')
        //     console.log(command)
        // });
        var d = new Date();
        var n = d.toLocaleTimeString();
        port.write('AT+CMGF=1\r\n'); // set SMS text mode
        port.write('AT+CMGS="639760371866"\r\n'); // send sms message
        port.write(`Hi this is a very long string.

Have a fu good day${n}\r\n`);
        port.write('\x1A');
        port.write('^z'); 

        // parser.once('data', (data) => {
        //     if (data.trim().endsWith('>')) {
        //     port.write(`${message}\x1A`, (err) => {
        //         if (err) {
        //         console.error('Error sending SMS:', err);
        //         }
        //     });
        //     } else {
        //     console.error('Error: Unexpected response after sending command');
        //     }
        // });
        setTimeout(() => {
            port.close(function (err) {
                console.log('port closed', err);
            });
        }, 9000);
    });

    parser.on('data', (data) => {
        console.log('Received data:', data);
    });

    port.on('error', (err) => {
        console.error('GSM modem error:', err);
    });

    port.on('close', data => {
        //whole message data
        console.log(`Event Close: ` + JSON.stringify(data));
    });


    res.sendFile("index.html", {'root': './client/build'});
});

app.listen(PORT, () => console.log(`App listening at port ${PORT}`));