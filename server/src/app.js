import express, { json } from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { SerialPort } from 'serialport'
import mongoose from 'mongoose'
import events from 'events'
import { debounce } from 'lodash';

main().catch(err => console.log(err));

async function main() {
    await mongoose.connect('mongodb://127.0.0.1:27017/sms');
}

const messageSchema = new mongoose.Schema({
    phoneNumber: String,
    message: String,
    storageIndex: String,
    status: String,
    type: String,
    messageDate: Date,
},
{
  timestamps: true
});

const Message = mongoose.model('Message', messageSchema);

var ee = new events.EventEmitter()

// ee.on('newMessage', console.log);

const app = express();

app.use(bodyParser.json());       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
    extended: true
})); 

app.use(json())

const PORT = process.env.PORT || 8000;

app.use('/', express.static(path.join(`${__dirname}./../../client`, 'build')))

app.get('/', async (req, res) => {
    res.sendFile("index.html", {'root': './client/build'});
});

app.post('/api/send-message', async (req, res) => {    

    const data = {
        phoneNumber: req.body.to,
        message: req.body.message,
        type: "sent",
        messageDate: new Date(),
    }
    const message = await Message.create(data);
    ee.emit('newMessage', message);
    console.log(data);
    res.json({
        message_gui: message.id,
        status: "ok"
    });
});

app.get('/messages', async (req, res) => {    
    const messages = await Message.find({}).sort({'_id': -1}).exec();
    res.json(messages);
});

app.get('/open', async (req, res) => {

    // const Readline = require('@serialport/parser-readline');
    const { ReadlineParser } = require('@serialport/parser-readline')

    const port = new SerialPort({ path: 'COM20', baudRate: 9600, autoOpen: false })
    const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    port.open(function (err) {
        if (err) {
          return console.log('Error opening port: ', err.message)
        }
        console.log('GSM modem is ready');
        port.write('ATE0\r');
    })

    let newMessage;
    port.on('open', async () => {

        setTimeout(() => {
            port.write('AT\r');
            port.write('AT+CMGF=1\r'); // set SMS text mode
            port.write('AT+CPMS="SM","SM"\r'); // Set storage mode https://www.developershome.com/sms/cpmsCommand.asp
            // port.write(`AT+CMGD=1,4\r`); // Delete all messages https://www.developershome.com/sms/cmgdCommand.asp
            // port.write('AT+CSCA="GSM"\r'); // Get all messages
            port.write('AT+CMGL="ALL"\r'); // Get all messages
        }, 1000);

        ee.on('newMessage', async (data) => {
            newMessage = await Message.findById(data.id).exec();
            port.write(`AT+CMGW="${data.phoneNumber}"\r\n`); // send sms message
            port.write(`${data.message}\r\n`);
            port.write('\x1A');
            port.write('^z');
        });

        setTimeout(() => {
            port.write(`AT+CMGD=1,4\r`); // Delete all messages https://www.developershome.com/sms/cmgdCommand.asp
            // port.write(`AT+CMGD=1,2\r\n`); // Delete all messages https://www.developershome.com/sms/cmgdCommand.asp
        }, 60 * 1000 * 1);

    });

    let lastCmd;

    parser.on('data', async (data) => {

        let index;
        let dataSplit = data.split(",");
        let smsStatus;
        console.log('Received data:', data);
        console.log('lastCmd:', lastCmd);
        switch (lastCmd) {
            case "CMGR":
                if(data != "OK"){
                    newMessage.message = data;
                    newMessage.save();
                }
                break;
            case "CMGL":
                if(data != "OK" && !/CMGL/.test(data)){
                    newMessage.message = data;
                    newMessage.save();
                }
                break;
            default:
                break;
        }
        switch (true) {
            case /AT/.test(data):
                lastCmd = "AT";
                break;
            case /RING/.test(data):
                lastCmd = "RING";
                port.write('AT+CHUP\r\n');
                break;
            case /\+CMS ERROR:/.test(data):
                lastCmd = "CMS ERROR";
                
                if (newMessage instanceof Message) {
                    newMessage.status = data;
                    newMessage.save();
                }
                break;
            case /OK/.test(data):
                lastCmd = "OK";
                break;
            case /\+CMGD:/.test(data): //delete certain message
                lastCmd = "CMGD";
                break;
            case /\+CMGR:/.test(data)://read certain message
                lastCmd = "CMGR";
                smsStatus = dataSplit[0].replace('+CMGR: ', '');
                smsStatus = smsStatus.replaceAll('"', '');
                newMessage.status = smsStatus;
                newMessage.phoneNumber = dataSplit[1].replaceAll('"', '');
                newMessage.messageDate = new Date();
                newMessage.type = /STO/.test(smsStatus) ? "sent" : "inbox";
                newMessage.save();
                port.write(`AT+CMGD=${newMessage.storageIndex}\r`); // delete message
                break;
            case /\+CMGL:/.test(data)://read all message from memory
                if(!/CMGL="ALL"/.test(data)){
                    lastCmd = "CMGL";
                    index = dataSplit[0].replace('+CMGL: ', '');
                    // console.log(dataSplit);
                    smsStatus = dataSplit[1].replaceAll('"', '');
                    newMessage = await Message.create({
                        message: "OK",
                        type: /STO/.test(smsStatus) ? "sent" : "inbox",
                        status: dataSplit[1].replaceAll('"', ''),
                        phoneNumber: dataSplit[2].replaceAll('"', ''),
                        messageDate: dataSplit[4].replaceAll('"', ''),
    
                        storageIndex: index,
                    });
                }
                break;
            case /\+CMGS:/.test(data)://send without saving to outbox
                lastCmd = "CMGS";
                break;
            case /\+CMSS:/.test(data): //send from outbox
                lastCmd = "CMSS";
                if(newMessage.storageIndex){
                    port.write(`AT+CMGR=${newMessage.storageIndex}\r`); //read message
                }
                break;
            case /\+CMGW:/.test(data): //move to outbox
                lastCmd = "CMGW";
                index = data.replace('+CMGW: ', '');
                newMessage.storageIndex = index;
                newMessage.save();
                port.write(`AT+CMSS=${index}\r`); //send from outbox
                break;
            case /\+CMTI:/.test(data): //incoming message
                lastCmd = "CMTI";
                index = dataSplit[1];
                newMessage = await Message.create({
                    message: "OK",
                    type: "inbox",
                    storageIndex: index,
                    messageDate: new Date(),
                });
                port.write(`AT+CMGR=${index}\r`); //read message
                break;
        
            default:
                break;
        }
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