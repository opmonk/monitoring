'use strict';

const mysql = require('mysql');
const request = require('request');
var sprintf = require("sprintf-js").sprintf;
var moment = require('moment-timezone');
moment().tz("America/Los_Angeles").format();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD
});

const channel = process.env.SLACK_CHANNEL || 'ben-test';


const formatCrawlerAlert = (results) => {
  let text = "";
  results.forEach(result => {
    text+=sprintf('%-10s%10f\n',result["status"],result["Total Count"]);
  });
  return "```" + text + "```";
}

module.exports.generateSlackAlert = async event => {
  const today = moment().date();
  const isOddDay = today%2==1;
  let startTime;
  let endTime;
  if (isOddDay && today != 31) {
    startTime = moment().subtract(1, "days").hour(1).minute(0).second(0).format("YYYY-MM-DD hh:mm:ss");
    endTime = moment().subtract(1, "days").hour(2).minute(0).second(0).format("YYYY-MM-DD hh:mm:ss");
  } else {
    startTime = moment().hour(1).minute(0).second(0).format("YYYY-MM-DD hh:mm:ss");
    endTime = moment().hour(2).minute(0).second(0).format("YYYY-MM-DD hh:mm:ss");
  }

  const sql = `
    select status, count(*) as "Total Count" from crawls where created_at > ? and created_at <= ? group by status
  `;

  const promise = new Promise(function(resolve, reject) {
    db.query(sql,[startTime,endTime], async function (error, results, fields) {
      let text = "*Crawler Alert:  " + moment().format("YYYY-MM-DD") + "*\n" + formatCrawlerAlert(results);
      console.log(text);

      request({method: 'POST', url: 'https://hooks.slack.com/services/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', json: true, body: {'username': 'IPSHARK-BOT','text': text, 'channel': channel}}, function(err, res, body) {
        if (err) console.log(err);
        resolve({
          statusCode: 200,
          body: text
        })
      });
    }).on('error', (e) => {
      reject(Error(e));
    });
  })
  
  return promise;

  // Use this code if you don't use the http event with the LAMBDA-PROXY integration
  // return { message: 'Go Serverless v1.0! Your function executed successfully!', event };
};

