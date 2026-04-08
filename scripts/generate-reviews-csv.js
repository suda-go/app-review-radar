const fs = require('fs');
const path = require('path');

// 配置参数
const CONFIG = {
  reviewsFilePath: path.join(__dirname, 'app-reviews', 'google_play_com.miui.videoplayer_reviews.json'),
  outputDir: path.join(__dirname, 'output'),
  outputFile: 'google_play_com.miui.videoplayer_reviews.csv'
};

// 确保输出目录存在
if (!fs.existsSync(CONFIG.outputDir)) {
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

// 读取评论数据
function readReviewsData() {
  console.log('正在读取评论数据...');
  try {
    const data = fs.readFileSync(CONFIG.reviewsFilePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('读取评论数据失败:', error.message);
    process.exit(1);
  }
}

// 转换评论数据为 CSV 格式
function transformToCSV(reviewsData) {
  console.log('正在转换数据为 CSV 格式...');
  const reviews = reviewsData.reviews.data;
  
  // CSV 表头
  const headers = ['评论ID', '用户名', '评分', '评论内容', '评论日期', '应用版本', '点赞数', '评论链接'];
  
  // 转换数据
  const rows = reviews.map(review => [
    `"${review.id}"`,
    `"${review.userName.replace(/"/g, '""')}"`,
    review.score,
    `"${(review.text || '').replace(/"/g, '""')}"`,
    new Date(review.date).toLocaleString('zh-CN'),
    `"${(review.version || '未知').replace(/"/g, '""')}"`,
    review.thumbsUp || 0,
    `"${review.url}"`
  ]);
  
  // 组合表头和数据
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
  
  console.log(`共转换 ${rows.length} 条评论数据`);
  return csvContent;
}

// 保存 CSV 文件
function saveCSV(csvContent) {
  console.log('正在保存 CSV 文件...');
  try {
    const outputPath = path.join(CONFIG.outputDir, CONFIG.outputFile);
    fs.writeFileSync(outputPath, csvContent, 'utf-8');
    console.log(`CSV 文件已保存到: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error('保存 CSV 文件失败:', error.message);
    process.exit(1);
  }
}

// 主函数
function main() {
  console.log('开始生成评论数据 CSV 文件...');
  
  // 读取数据
  const reviewsData = readReviewsData();
  
  // 转换为 CSV
  const csvContent = transformToCSV(reviewsData);
  
  // 保存文件
  const outputPath = saveCSV(csvContent);
  
  console.log('\nCSV 文件生成完成！');
  console.log('请按照以下步骤将数据导入到飞书表格：');
  console.log('1. 打开飞书，创建一个新的表格');
  console.log('2. 点击「导入数据」按钮');
  console.log('3. 选择「从 CSV 文件导入」');
  console.log('4. 上传生成的 CSV 文件');
  console.log('5. 确认字段映射后完成导入');
  console.log(`\nCSV 文件路径: ${outputPath}`);
}

// 运行主函数
main();
