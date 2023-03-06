import express, { json } from 'express';
import path from 'path';

const app = express();

app.use(json())

const PORT = process.env.PORT || 8000;

app.use('/', express.static(path.join(`${__dirname}./../../client`, 'build')))

app.get('/', async (req, res) => {
    res.sendFile("index.html", {'root': './client/build'});
});

app.listen(PORT, () => console.log(`App listening at port ${PORT}`));