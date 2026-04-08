const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');

const gplay = require('google-play-scraper').default;
const appstore = require('app-store-scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

function isChinese(text) {
  if (!text) return true;
  const cnCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return cnCount / text.length > 0.3;
}

function translateText(text, targetLang = 'zh-CN') {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(text);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encoded}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const translated = json[0].map(s => s[0]).join('');
          resolve(translated);
        } catch (e) { resolve(text); }
      });
    }).on('error', () => resolve(text));
  });
}

async function translateReviews(reviews) {
  const result = [];
  for (const r of reviews) {
    const textNeedTranslate = r.text && !isChinese(r.text);
    const titleNeedTranslate = r.title && !isChinese(r.title);
    let textZh = '';
    let titleZh = '';
    if (textNeedTranslate) {
      textZh = await translateText(r.text);
    }
    if (titleNeedTranslate) {
      titleZh = await translateText(r.title);
    }
    result.push({ ...r, textZh, titleZh });
  }
  return result;
}

// 爬取评论的API
app.post('/api/scrape-reviews', async (req, res) => {
    try {
        const { platform, appId, country, lang, maxReviews, dateFrom, dateTo } = req.body;
        
        console.log('爬取请求:', { platform, appId, country, lang, maxReviews, dateFrom, dateTo });
        
        let reviews = [];
        
        if (platform === 'android') {
            console.log('正在爬取Google Play评论...');
            const result = await gplay.reviews({
                appId,
                country,
                lang: lang || country,
                sort: gplay.sort.NEWEST,
                num: maxReviews || 100
            });
            
            reviews = result.data || [];
            console.log(`成功获取 ${reviews.length} 条Google Play评论`);
        } else if (platform === 'ios') {
            console.log('正在爬取App Store评论...');
            const num = maxReviews || 100;
            const pages = Math.ceil(num / 10);
            let allReviews = [];

            for (let page = 1; page <= pages; page++) {
                try {
                    const result = await appstore.reviews({
                        id: appId,
                        country: country || 'us',
                        sort: appstore.sort.RECENT,
                        page
                    });
                    if (!result || result.length === 0) break;
                    allReviews = allReviews.concat(result);
                    if (allReviews.length >= num) break;
                } catch (pageErr) {
                    console.error(`App Store 第 ${page} 页爬取失败:`, pageErr.message);
                    break;
                }
            }

            reviews = allReviews.slice(0, num).map(r => ({
                id: r.id,
                userName: r.userName,
                score: r.score,
                title: r.title || '',
                text: r.text || '',
                date: r.updated || r.date || '',
                version: r.version || '',
                thumbsUp: r.voteCount || 0,
                url: r.url || ''
            }));
            console.log(`成功获取 ${reviews.length} 条App Store评论`);
        } else {
            return res.status(400).json({ error: '不支持的平台' });
        }
        
        if (dateFrom || dateTo) {
            const from = dateFrom ? new Date(dateFrom + 'T00:00:00Z').getTime() : 0;
            const to = dateTo ? new Date(dateTo + 'T23:59:59Z').getTime() : Infinity;
            const before = reviews.length;
            reviews = reviews.filter(r => {
                if (!r.date) return false;
                const t = new Date(r.date).getTime();
                return t >= from && t <= to;
            });
            console.log(`日期过滤: ${before} -> ${reviews.length} 条 (${dateFrom || '不限'} ~ ${dateTo || '不限'})`);
        }
        
        console.log('正在翻译非中文评论...');
        reviews = await translateReviews(reviews);
        console.log('翻译完成');
        
        res.json({ success: true, reviews });
    } catch (error) {
        console.error('爬取评论失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 首页
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'app-review-scraper.html'));
});

app.post('/api/app-info', async (req, res) => {
    try {
        const { platform, appId, country, lang } = req.body;
        let info = { title: appId, icon: '' };
        if (platform === 'android') {
            const detail = await gplay.app({ appId, country: country || 'us', lang: lang || 'en' });
            info = { title: detail.title || appId, icon: detail.icon || '' };
        } else if (platform === 'ios') {
            const detail = await appstore.app({ id: parseInt(appId), country: country || 'us' });
            info = { title: detail.title || appId, icon: detail.icon || '' };
        }
        res.json({ success: true, info });
    } catch (error) {
        console.error('获取应用信息失败:', error.message);
        res.json({ success: true, info: { title: req.body.appId, icon: '' } });
    }
});

app.post('/api/analyze-reviews', async (req, res) => {
    try {
        const { reviews } = req.body;
        if (!reviews || !reviews.length) {
            return res.status(400).json({ error: '无评论数据' });
        }

        const total = reviews.length;
        const dist = [0, 0, 0, 0, 0];
        reviews.forEach(r => { if (r.score >= 1 && r.score <= 5) dist[r.score - 1]++; });
        const avg = reviews.reduce((s, r) => s + (r.score || 0), 0) / total;

        const getText = r => r.textZh || r.text || '';

        const positive = reviews.filter(r => r.score >= 4);
        const neutral = reviews.filter(r => r.score === 3);
        const negative = reviews.filter(r => r.score <= 2);

        function extractKeywords(items, topN = 8) {
            const freq = {};
            items.forEach(r => {
                const t = getText(r);
                const words = t.replace(/[^\u4e00-\u9fffA-Za-z\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
                const seen = new Set();
                words.forEach(w => {
                    const lw = w.toLowerCase();
                    if (!seen.has(lw)) { seen.add(lw); freq[lw] = (freq[lw] || 0) + 1; }
                });
            });
            const stopwords = new Set(['the','and','for','that','this','with','not','but','are','was','have','has','very','just','from','they','been','will','can','app','yang','dan','ini','itu','ada','tidak','bisa','untuk','saya','dengan','jadi','sudah','tapi','juga','nya','dari','apa','kalau','sama','lagi','kok','banget','gak','yg','udah','biar','mau','kalo','bgt','nya','ga','deh','dong','lah','aja','nih','sih']);
            return Object.entries(freq)
                .filter(([w]) => !stopwords.has(w) && w.length >= 2)
                .sort((a, b) => b[1] - a[1])
                .slice(0, topN)
                .map(([word, count]) => ({ word, count }));
        }

        function pickSamples(items, n = 3) {
            const sorted = [...items].sort((a, b) => (b.thumbsUp || 0) - (a.thumbsUp || 0));
            return sorted.slice(0, n).map(r => ({
                user: r.userName,
                score: r.score,
                text: getText(r).slice(0, 200),
                thumbsUp: r.thumbsUp || 0
            }));
        }

        function groupByVersion(items) {
            const vMap = {};
            items.forEach(r => {
                const v = r.version || '未知';
                if (!vMap[v]) vMap[v] = { count: 0, scores: [] };
                vMap[v].count++;
                vMap[v].scores.push(r.score || 0);
            });
            return Object.entries(vMap)
                .map(([version, d]) => ({
                    version,
                    count: d.count,
                    avg: (d.scores.reduce((a, b) => a + b, 0) / d.scores.length).toFixed(1)
                }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);
        }

        const analysis = {
            overview: {
                total,
                avgScore: avg.toFixed(2),
                distribution: { '5星': dist[4], '4星': dist[3], '3星': dist[2], '2星': dist[1], '1星': dist[0] },
                positiveRate: ((positive.length / total) * 100).toFixed(1) + '%',
                negativeRate: ((negative.length / total) * 100).toFixed(1) + '%'
            },
            positiveAnalysis: {
                count: positive.length,
                keywords: extractKeywords(positive),
                samples: pickSamples(positive)
            },
            negativeAnalysis: {
                count: negative.length,
                keywords: extractKeywords(negative),
                samples: pickSamples(negative)
            },
            neutralAnalysis: {
                count: neutral.length,
                keywords: extractKeywords(neutral)
            },
            versionAnalysis: groupByVersion(reviews),
            allKeywords: extractKeywords(reviews, 12)
        };

        console.log('评论分析完成');
        res.json({ success: true, analysis });
    } catch (error) {
        console.error('分析评论失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`打开 http://localhost:${PORT} 开始使用应用商店评论爬取工具`);
});
