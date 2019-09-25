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


/**
* Calculates useful crawler summaries, such as percent finished and unsuccessful
* @params {object} DB results object that contains crawling status with their counts
* @returns {object} summary object
*/
const calculateSummary = (results) => {
  let total = 0;
  let unsuccessful = 0; // failed + cancelled
  let outstanding = 0; // crawling + scheduled

  results.forEach(result => {
    const count = result["Total Count"];
    const status = result["status"];

    if (status == 'cancelled' || status == 'failure') unsuccessful += count;
    else if (status == 'scheduled' || status == 'crawling') outstanding += count;
    total += count;
  });

  const finishedPercentage = ((total - outstanding) / total * 100).toFixed(2);
  const unsuccessfulPercentage = (unsuccessful / total * 100).toFixed(2);
  return {
    finishedPercentage,
    unsuccessfulPercentage
  };
};

/**
* Generates & formats Slack crawler alert message
* @params {object} DB results data along with summary data (and start/end info)
* @returns {string} slack alert text
*/
const formatCrawlerAlert = (results) => {
  const {
    data,
    summary,
    summary: {
      startTime,
      endTime,
      unsuccessfulPercentage,
      finishedPercentage
    }
  } = results;

  const [today, startHour] = startTime.split(" ");
  const endHour = endTime.split(" ")[1];

  let title = `:alarm_clock:  *Crawler Alert*: ${today} (${startHour} to ${endHour})\n`;
  let text = "";

  data.forEach(item => {
    text += sprintf('%-10s%10f\n', item["status"], item["Total Count"]);
  });

  title += `:white_check_mark:  *Finished*: ${summary.finishedPercentage}%\n`;
  title += `:x:  *Unsuccessful*: ${summary.unsuccessfulPercentage}%\n`;
  return title + "```" + text + "```";
};

/**
* Generates Slack alert
* @params {void}
* @returns {string} returns string body of slack alert text. Also posts to slack.
*/
module.exports.generateSlackAlert = async event => {
  const today = moment().date();
  const isOddDay = today % 2 == 1;
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
    db.query(sql, [startTime, endTime], async function(error, results, fields) {
      const summary = calculateSummary(results);
      summary.startTime = startTime;
      summary.endTime = endTime;
      let text = formatCrawlerAlert({
        data: results,
        summary
      });
      console.log("Slack Text:",text);

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
};