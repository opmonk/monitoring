'use strict';

const mysql = require('mysql');
const request = require('request');
var sprintf = require("sprintf-js").sprintf;
var moment = require('moment-timezone');
moment().tz("America/Los_Angeles").format();
var querystring = require('querystring');

const CHANNEL = process.env.SLACK_CHANNEL || 'ben-test';
const SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/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';
const numOfCycles = 4;


const createConnection = () => {
  return mysql.createConnection({
      host: process.env.DB_HOST,
      database: process.env.DB_DATABASE,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD
    });
};

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

  let title = `*Crawler Alert*: ${today} (${startHour} to ${endHour})\n`;
  let text = "";

  data.forEach(item => {
    text += sprintf('%-10s%10f\n', item["status"], item["Total Count"]);
  });

  // title += `:white_check_mark:  *Finished*: ${summary.finishedPercentage}%\n`;
  // title += `:x:  *Unsuccessful*: ${summary.unsuccessfulPercentage}%\n`;
  return title + "```" + text + "```";
};

/**
 * Generates Slack alert
 * @params {void}
 * @returns {string} returns string body of slack alert text. Also posts to slack.
 */
module.exports.generateSlackAlert = async event => {
  const db = createConnection();
  const today = moment().date();
  const isOddDay = today % 2 == 1;
  let startTime;
  let endTime;
  if (isOddDay && today != 31) {
    startTime = moment().subtract(1, "days").hour(2).minute(0).second(0).format("YYYY-MM-DD hh:mm:ss");
    endTime = moment().subtract(1, "days").hour(3).minute(0).second(0).format("YYYY-MM-DD hh:mm:ss");
  } else {
    startTime = moment().hour(2).minute(0).second(0).format("YYYY-MM-DD hh:mm:ss");
    endTime = moment().hour(3).minute(0).second(0).format("YYYY-MM-DD hh:mm:ss");
  }

  const sql = `
    select status, count(*) as "Total Count" from crawls where created_at > ? and created_at <= ? group by status
  `;

  const promise = new Promise(function(resolve, reject) {
    db.query(sql, [startTime, endTime], async function(error, results, fields) {
      db.end();
      const summary = Object.assign({startTime,endTime},calculateSummary(results));
      console.log(process.env)
      let text = formatCrawlerAlert({
        data: results,
        summary
      });
      console.log("Slack Text:", text);

      request({
        method: 'POST',
        url: SLACK_WEBHOOK_URL,
        json: true,
        body: {
          'username': 'IPSHARK-BOT',
          'text': text,
          'channel': CHANNEL,
          color: "#2eb886"
        }
      }, function(err, res, body) {
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

const cleanString = (str) => {
  return str.replace(/,/g, '');
};


/**
 * Generates Pending Listings to be Closed Report
 * @params {void}
 * @returns {string} returns string body of slack alert text. Also posts to slack.
 */
module.exports.generatePendingClosedSummary = async event => {
  const db = createConnection();
  const sql = `
    SELECT count(*) AS count FROM discoveries 
    WHERE cached_status='pending' 
      AND last_seen_at < DATE_SUB(NOW(), INTERVAL 7 DAY);
  `;

  const pendingResubmitSql = `
    SELECT count(*) AS count FROM discoveries 
    WHERE cached_status='pending' 
      AND (last_seen_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            AND updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
          );
  `;
  const promise = new Promise(function(resolve, reject) {
    db.query(sql, [], async function(error, results, fields) {
      db.end();
      const count = results[0]["count"];
      const text = `There are ${count} pending listings to be closed`;

      request({
        method: 'POST',
        url: SLACK_WEBHOOK_URL,
        json: true,
        body: {
          'username': 'IPSHARK-BOT',
          'text': text,
          'channel': CHANNEL,
          color: "#2eb886"
        }
      }, function(err, res, body) {
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

/**
 * Generates Pending Listings to be Resubmit Report
 * @params {void}
 * @returns {string} returns string body of slack alert text. Also posts to slack.
 */
module.exports.generatePendingResubmitSummary = async event => {
  const db = createConnection();
  const sql = `
    SELECT count(*) AS count FROM discoveries 
    WHERE cached_status='pending' 
      AND (last_seen_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            AND updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
          );
  `;
  const promise = new Promise(function(resolve, reject) {
    db.query(sql, [], async function(error, results, fields) {
      db.end();
      const count = results[0]["count"];
      const text = `There are ${count} pending listings to be resubmit`;

      request({
        method: 'POST',
        url: SLACK_WEBHOOK_URL,
        json: true,
        body: {
          'username': 'IPSHARK-BOT',
          'text': text,
          'channel': CHANNEL,
          color: "#2eb886"
        }
      }, function(err, res, body) {
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