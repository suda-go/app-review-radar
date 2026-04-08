const fs = require('fs');
const path = require('path');

// 配置参数
const CONFIG = {
  reviewsFilePath: path.join(__dirname, 'app-reviews', 'google_play_com.miui.videoplayer_reviews.json'),
  outputDir: path.join(__dirname, 'output'),
  outputFile: 'google_play_com.miui.videoplayer_reviews_for_mcp.json'
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

// 转换评论数据为飞书 MCP 格式
function transformForMCP(reviewsData) {
  console.log('正在转换数据为飞书 MCP 格式...');
  const reviews = reviewsData.reviews.data;
  
  // 转换数据结构
  const transformedData = reviews.map(review => ({
    评论ID: review.id,
    用户名: review.userName,
    评分: review.score,
    评论内容: review.text || '',
    评论日期: new Date(review.date).toLocaleString('zh-CN'),
    应用版本: review.version || '未知',
    点赞数: review.thumbsUp || 0,
    评论链接: review.url
  }));
  
  console.log(`共转换 ${transformedData.length} 条评论数据`);
  return transformedData;
}

// 保存为 JSON 文件
function saveForMCP(data) {
  console.log('正在保存数据文件...');
  try {
    const outputPath = path.join(CONFIG.outputDir, CONFIG.outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`数据文件已保存到: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error('保存数据文件失败:', error.message);
    process.exit(1);
  }
}

// 主函数
function main() {
  console.log('开始准备飞书 MCP 数据...');
  
  // 读取数据
  const reviewsData = readReviewsData();
  
  // 转换数据
  const transformedData = transformForMCP(reviewsData);
  
  // 保存文件
  const outputPath = saveForMCP(transformedData);
  
  console.log('\n数据准备完成！');
  console.log('请按照以下步骤使用飞书官方远程 MCP 导入数据：');
  console.log('1. 打开 https://open.feishu.cn/page/mcp/7618185159730482141');
  console.log('2. 登录飞书，生成个人 MCP URL');
  console.log('3. 在 IDE 中配置 MCP 客户端，添加飞书官方远程 MCP');
  console.log('4. 使用飞书 MCP 的 "创建表格" 工具创建一个新表格');
  console.log('5. 使用飞书 MCP 的 "写入数据" 工具，选择生成的 JSON 文件导入数据');
  console.log(`\n数据文件路径: ${outputPath}`);
}

// 运行主函数
main();
