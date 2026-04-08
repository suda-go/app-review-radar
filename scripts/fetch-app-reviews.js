const fs = require('fs');
const path = require('path');

// 导入实际的库
const gplay = require('google-play-scraper').default;
// const appstore = require('app-store-scraper');

// 配置参数
const CONFIG = {
  googlePlayApps: [
    { appId: 'com.miui.videoplayer', country: 'ID', lang: 'id' }
  ],
  appStoreApps: [
    // { appId: '123456789', country: 'us' },
    // { appId: '987654321', country: 'us' }
  ],
  maxReviews: 100, // 每个应用获取的最大评论数
  outputDir: path.join(__dirname, 'app-reviews')
};

// 确保输出目录存在
if (!fs.existsSync(CONFIG.outputDir)) {
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

// 实际获取 Google Play 评论的函数
async function fetchGooglePlayReviews(appId, country, lang, maxResults) {
  console.log(`正在获取 Google Play 应用 ${appId} 的评论...`);
  try {
    // 检查 gplay 对象的结构
    console.log('gplay 对象:', Object.keys(gplay));
    console.log('gplay.sort:', gplay.sort);
    
    // 使用正确的 API 调用方式
    const reviews = await gplay.reviews({
      appId: appId,
      country: country,
      lang: lang,
      sort: gplay.sort.NEWEST,
      num: maxResults
    });
    
    return {
      appId,
      country,
      lang,
      reviews
    };
  } catch (error) {
    console.error(`获取 Google Play 评论时出错:`, error.message);
    throw error;
  }
}

// 模拟获取 Apple App Store 评论的函数
async function fetchAppStoreReviews(appId, country, maxResults) {
  console.log(`正在获取 Apple App Store 应用 ${appId} 的评论...`);
  // 实际使用时替换为：
  // return await appstore.reviews({
  //   id: appId,
  //   country,
  //   sort: appstore.sort.RECENT,
  //   num: maxResults
  // });
  
  // 模拟数据
  return {
    appId,
    country,
    reviews: Array.from({ length: 10 }, (_, i) => ({
      id: `review-${i}`,
      userName: `User ${i}`,
      rating: Math.floor(Math.random() * 5) + 1,
      title: `评论标题 ${i}`,
      content: `这是一条模拟的 Apple App Store 评论 ${i}`,
      version: `1.${i}.0`,
      date: new Date(Date.now() - i * 86400000).toISOString(),
      voteCount: Math.floor(Math.random() * 100)
    }))
  };
}

// 保存评论数据到文件
function saveReviewsToFile(platform, appId, data) {
  const fileName = `${platform}_${appId}_reviews.json`;
  const filePath = path.join(CONFIG.outputDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`评论数据已保存到: ${filePath}`);
}

// 主函数
async function main() {
  console.log('开始批量获取应用商店评论...');
  
  // 获取 Google Play 评论
  console.log('\n=== 获取 Google Play 评论 ===');
  for (const app of CONFIG.googlePlayApps) {
    try {
      const data = await fetchGooglePlayReviews(app.appId, app.country, app.lang, CONFIG.maxReviews);
      saveReviewsToFile('google_play', app.appId, data);
    } catch (error) {
      console.error(`获取 Google Play 应用 ${app.appId} 的评论失败:`, error.message);
    }
  }
  
  // 获取 Apple App Store 评论
  console.log('\n=== 获取 Apple App Store 评论 ===');
  for (const app of CONFIG.appStoreApps) {
    try {
      const data = await fetchAppStoreReviews(app.appId, app.country, CONFIG.maxReviews);
      saveReviewsToFile('app_store', app.appId, data);
    } catch (error) {
      console.error(`获取 Apple App Store 应用 ${app.appId} 的评论失败:`, error.message);
    }
  }
  
  console.log('\n评论获取完成！');
}

// 运行主函数
main();
