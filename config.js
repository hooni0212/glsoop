// config.js
require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('GMAIL_USER =', process.env.GMAIL_USER);
console.log(
  'GMAIL_PASS length =',
  process.env.GMAIL_PASS ? process.env.GMAIL_PASS.length : 0
);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

const JWT_SECRET = process.env.JWT_SECRET || 'DEV_ONLY_FALLBACK_SECRET';

module.exports = {
  transporter,
  JWT_SECRET,
};
