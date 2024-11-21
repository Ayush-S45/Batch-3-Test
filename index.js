const express = require('express');
const fs = require('fs');
const axios = require('axios');
const cors = require('cors');
const { Parser } = require('json2csv');
const app = express();
const port = 3001;

app.use(cors());
app.use(express.static('public')); // Serve static files from 'public' directory (e.g., index.html)

const userStatsQuery = `
  query userStats($username: String!) {
    matchedUser(username: $username) {
      username
      submitStats: submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
          submissions
        }
      }
    }
  }
`;

const recentSubQuery = `
  query recentAcSubmissions($username: String!, $limit: Int!) {
    recentAcSubmissionList(username: $username, limit: $limit) {
      id
      title
      timestamp
      statusDisplay
      runtime
      memory
      lang
    }
  }
`;

async function fetchLeet(username) {
  const graphqlUrl = "https://leetcode.com/graphql";

  try {
    const statsResponse = await axios.post(graphqlUrl, {
      query: userStatsQuery,
      variables: { username },
    });

    const recentSubResponse = await axios.post(graphqlUrl, {
      query: recentSubQuery,
      variables: { username, limit: 3 }, // Fetch the latest 3 submissions
    });

    const userStats = statsResponse.data.data.matchedUser.submitStats.acSubmissionNum || [];
    const recentSubmissions = recentSubResponse.data.data.recentAcSubmissionList || [];

    const stats = {
      totalSolved: 0,
      easySolved: 0,
      mediumSolved: 0,
      hardSolved: 0,
    };

    userStats.forEach(item => {
      switch (item.difficulty) {
        case "All":
          stats.totalSolved = item.count;
          break;
        case "Easy":
          stats.easySolved = item.count;
          break;
        case "Medium":
          stats.mediumSolved = item.count;
          break;
        case "Hard":
          stats.hardSolved = item.count;
          break;
        default:
          break;
      }
    });

    return {
      stats,
      recentSubmissions,
    };
  } catch (error) {
    console.error(`Error fetching data for ${username}:`, error);
    return {
      stats: {
        totalSolved: 0,
        easySolved: 0,
        mediumSolved: 0,
        hardSolved: 0,
      },
      recentSubmissions: [],
    };
  }
}

async function fetchAndSaveData() {
  try {
    const rolls = fs.readFileSync('roll.txt', 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
    const names = fs.readFileSync('name.txt', 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
    const urls = fs.readFileSync('urls.txt', 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
    const sections = fs.readFileSync('sections.txt', 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
    const day = fs.readFileSync('day.txt', 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);

    if (rolls.length !== names.length || names.length !== urls.length || names.length !== sections.length) {
      console.error('Error: The number of rolls, names, URLs, and sections do not match.');
      return;
    }

    const combinedData = [];

    async function processStudentData(i) {
      const roll = rolls[i];
      const name = names[i];
      const url = urls[i];
      const section = sections[i];
      const dayi = day[i];
      let studentData = { roll, name, url, section, dayi };

      if (url.startsWith('https://leetcode.com/u/')) {
        let username = url.split('/u/')[1];
        if (username.charAt(username.length - 1) === '/') username = username.substring(0, username.length - 1);

        try {
          const { stats, recentSubmissions } = await fetchLeet(username);
          studentData = {
            ...studentData,
            username,
            totalSolved: stats.totalSolved,
            easySolved: stats.easySolved,
            mediumSolved: stats.mediumSolved,
            hardSolved: stats.hardSolved,
            recentSubmissions,
          };
        } catch (error) {
          console.error(`Error fetching data for ${username}:`, error);
        }
      } else {
        studentData.info = 'No LeetCode data available';
      }

      combinedData.push(studentData);
    }

    const promises = [];
    for (let i = 0; i < rolls.length; i++) {
      promises.push(processStudentData(i));
    }
    await Promise.all(promises);

    combinedData.sort((a, b) => b.totalSolved - a.totalSolved);

    fs.writeFileSync('data.json', JSON.stringify(combinedData, null, 2));
    console.log('Data saved to data.json successfully.');
  } catch (error) {
    console.error('Error processing data:', error);
  }
}

// API to get leaderboard data
app.get('/data', (req, res) => {
  res.sendFile(__dirname + '/data.json');
});

// API to get recent submissions
app.get('/recent-submissions', async (req, res) => {
  try {
    let recentSubmissions = [];
    const rolls = fs.readFileSync('roll.txt', 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
    const urls = fs.readFileSync('urls.txt', 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);

    for (let i = 0; i < rolls.length; i++) {
      const url = urls[i];
      if (url.startsWith('https://leetcode.com/u/')) {
        const username = url.split('/u/')[1];
        const { recentSubmissions: submissions } = await fetchLeet(username);

        submissions.forEach(submission => {
          recentSubmissions.push({
            username,
            title: submission.title,
            timestamp: submission.timestamp,
          });
        });
      }
    }

    recentSubmissions.sort((a, b) => b.timestamp - a.timestamp);

    if (recentSubmissions.length > 0) {
      res.json(recentSubmissions);
    } else {
      res.status(404).json({ message: "No recent submissions found." });
    }
  } catch (error) {
    console.error("Error fetching recent submissions:", error);
    res.status(500).json({ message: "Error fetching recent submissions." });
  }
});

// API to export leaderboard data to CSV
app.get('/export-csv', async (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync('data.json', 'utf-8'));
    const json2csvParser = new Parser();
    const csv = json2csvParser.parse(data);
    res.header('Content-Type', 'text/csv');
    res.attachment('leaderboard.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting to CSV:', error);
    res.status(500).json({ message: 'Error exporting to CSV.' });
  }
});

// Fetch and save data every hour
fetchAndSaveData();
setInterval(fetchAndSaveData, 60 * 60 * 1000);

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

