const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 配置参数
const CONFIG = {
  reviewsFilePath: path.join(__dirname, 'app-reviews', 'google_play_com.miui.videoplayer_reviews.json'),
  appToken: 'A3WnbdoN8aUjJNshOAecdnt4nRd', // 使用与 fetch-feedback-data.js 相同的 token
  tableName: '应用商店评论', // 表格名称
  outputDir: path.join(__dirname, 'feishu-output')
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

// 转换评论数据为飞书表格格式
function transformReviewsData(reviewsData) {
  console.log('正在转换评论数据...');
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

// 创建飞书表格
function createFeishuTable() {
  console.log('正在创建飞书表格...');
  try {
    // 首先获取应用的元数据，查看是否已存在同名表格
    const metaCmd = `feishu bitable meta ${CONFIG.appToken}`;
    const metaResult = execSync(metaCmd, { encoding: 'utf-8' });
    const metaData = JSON.parse(metaResult);
    
    // 查找是否已存在同名表格
    let existingTable = null;
    if (metaData.tables) {
      existingTable = metaData.tables.find(table => table.name === CONFIG.tableName);
    }
    
    if (existingTable) {
      console.log(`表格 ${CONFIG.tableName} 已存在，使用现有表格`);
      return existingTable.table_id;
    }
    
    // 创建新表格
    const createCmd = `feishu bitable create-table ${CONFIG.appToken} --name "${CONFIG.tableName}"`;
    const createResult = execSync(createCmd, { encoding: 'utf-8' });
    const createData = JSON.parse(createResult);
    
    console.log(`表格 ${CONFIG.tableName} 创建成功`);
    return createData.table_id;
  } catch (error) {
    console.error('创建飞书表格失败:', error.message);
    process.exit(1);
  }
}

// 确保表格字段存在
function ensureTableFields(tableId) {
  console.log('正在确保表格字段存在...');
  try {
    // 获取表格字段信息
    const fieldsCmd = `feishu bitable fields ${CONFIG.appToken} ${tableId}`;
    const fieldsResult = execSync(fieldsCmd, { encoding: 'utf-8' });
    const fields = JSON.parse(fieldsResult);
    
    // 需要的字段
    const requiredFields = [
      { name: '评论ID', type: 'text' },
      { name: '用户名', type: 'text' },
      { name: '评分', type: 'number' },
      { name: '评论内容', type: 'text' },
      { name: '评论日期', type: 'text' },
      { name: '应用版本', type: 'text' },
      { name: '点赞数', type: 'number' },
      { name: '评论链接', type: 'url' }
    ];
    
    // 检查并创建缺失的字段
    for (const field of requiredFields) {
      const existingField = fields.find(f => f.name === field.name);
      if (!existingField) {
        const createFieldCmd = `feishu bitable field create ${CONFIG.appToken} ${tableId} "${field.name}" ${field.type}`;
        execSync(createFieldCmd, { encoding: 'utf-8' });
        console.log(`创建字段: ${field.name}`);
      }
    }
  } catch (error) {
    console.error('确保表格字段存在失败:', error.message);
    process.exit(1);
  }
}

// 导入数据到飞书表格
function importDataToFeishu(tableId, data) {
  console.log('正在导入数据到飞书表格...');
  
  // 分批导入数据，每批最多500条（飞书API限制）
  const batchSize = 500;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    console.log(`正在导入第 ${Math.floor(i / batchSize) + 1} 批数据，共 ${batch.length} 条`);
    
    // 转换为飞书 API 要求的格式
    const records = batch.map(item => ({
      fields: item
    }));
    
    // 保存为临时文件
    const tempFile = path.join(CONFIG.outputDir, `temp_records_${i}.json`);
    fs.writeFileSync(tempFile, JSON.stringify(records, null, 2));
    
    // 导入数据
    try {
      const importCmd = `feishu bitable batch-create ${CONFIG.appToken} ${tableId} --file ${tempFile}`;
      execSync(importCmd, { encoding: 'utf-8' });
      console.log(`第 ${Math.floor(i / batchSize) + 1} 批数据导入成功`);
    } catch (error) {
      console.error(`第 ${Math.floor(i / batchSize) + 1} 批数据导入失败:`, error.message);
    }
    
    // 删除临时文件
    fs.unlinkSync(tempFile);
  }
}

// 获取表格链接
function getTableLink(tableId) {
  console.log('正在获取表格链接...');
  try {
    // 使用飞书 API 获取表格信息
    const infoCmd = `feishu bitable table info ${CONFIG.appToken} ${tableId}`;
    const infoResult = execSync(infoCmd, { encoding: 'utf-8' });
    const info = JSON.parse(infoResult);
    
    // 构建表格链接
    // 注意：实际的链接格式可能需要根据飞书 API 的返回结果进行调整
    const tableLink = `https://bytedance.larkoffice.com/sheets/${info.table_id}`;
    console.log(`表格链接: ${tableLink}`);
    return tableLink;
  } catch (error) {
    console.error('获取表格链接失败:', error.message);
    return null;
  }
}

// 主函数
function main() {
  console.log('开始将评论数据导入到飞书表格...');
  
  // 读取并转换数据
  const reviewsData = readReviewsData();
  const transformedData = transformReviewsData(reviewsData);
  
  // 创建或获取表格
  const tableId = createFeishuTable();
  
  // 确保表格字段存在
  ensureTableFields(tableId);
  
  // 导入数据
  importDataToFeishu(tableId, transformedData);
  
  // 获取表格链接
  const tableLink = getTableLink(tableId);
  
  console.log('\n数据导入完成！');
  if (tableLink) {
    console.log(`表格链接: ${tableLink}`);
  }
}

// 运行主函数
main();
