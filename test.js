const axios = require('axios');

const YOUR_GENERATED_SECRET = '9VFMTHCukRuT5WqOkAD1:8cde275ebde49165527e9c97ecc96abef1e34473458fe8f9f3ecad177a163538';

const headers = {
  'x-api-key': `token ${YOUR_GENERATED_SECRET}`,
  'Content-Type': 'application/json'
};

const data = {
  data: {
    prompt: 'What is distributed systems? Short answer',
    targetModel: 'chatgpt'
  }
};

axios.post('https://us-central1-prompt-ops.cloudfunctions.net/optimize', data, { headers })
  .then(response => {
    console.log(response.data);
  })
  .catch(error => {
    console.error(error);
  });
