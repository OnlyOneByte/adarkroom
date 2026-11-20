import express from 'express';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST; // unset = all interfaces (upstream behaviour)

const app = express();
app.use(express.static('.'));

app.listen(PORT, HOST, () => console.log(`Listening on ${HOST || '*'}:${PORT}`));
