// 真机局域网调试需同步后端 HOST 与 PUBLIC_BASE_URL，步骤见 README 的同一 Wi-Fi 真机调试。
// 复制为 config.js 后填写本地配置。此文件可提交，config.js 不提交。
// AppSecret、访问令牌等密钥只能放后端，不能放入任何小程序代码。
module.exports = {
  environment: 'development',
  apiBaseUrl: 'http://127.0.0.1:3210/v1',
  operatorContact: ''
};
