const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_TOKEN = 'A3WnbdoN8aUjJNshOAecdnt4nRd';
const TABLE_ID = 'tblQ9pOzGPQyzUIm';
const OUTPUT_FILE = path.join(__dirname, 'data.json');

function fetchRecords(pageToken = null) {
    let cmd = `feishu bitable records ${APP_TOKEN} ${TABLE_ID} --page-size 500`;
    if (pageToken) {
        cmd += ` --page-token ${pageToken}`;
    }
    
    try {
        const result = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
        return JSON.parse(result);
    } catch (error) {
        console.error('Error fetching records:', error.message);
        return null;
    }
}

function main() {
    console.log('开始获取飞书多维表格数据...');
    
    let allRecords = [];
    let pageToken = null;
    let hasMore = true;
    let total = 0;
    let pageCount = 0;
    
    while (hasMore) {
        pageCount++;
        console.log(`正在获取第 ${pageCount} 页...`);
        
        const data = fetchRecords(pageToken);
        if (!data) {
            console.error('获取数据失败');
            process.exit(1);
        }
        
        if (data.records) {
            allRecords = allRecords.concat(data.records);
        }
        
        total = data.total || 0;
        hasMore = data.has_more || false;
        pageToken = data.page_token || null;
        
        console.log(`已获取 ${allRecords.length} / ${total} 条记录`);
        
        if (!hasMore) break;
        
        require('fs').writeFileSync(OUTPUT_FILE, JSON.stringify(allRecords, null, 2));
    }
    
    require('fs').writeFileSync(OUTPUT_FILE, JSON.stringify(allRecords, null, 2));
    console.log(`\n数据获取完成！共 ${allRecords.length} 条记录`);
    console.log(`数据已保存到: ${OUTPUT_FILE}`);
}

main();
