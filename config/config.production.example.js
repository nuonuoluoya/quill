// 生产配置示例；复制字段到 config.js 时保留自己的运营联系方式。
// 微信平台 request 和 downloadFile 合法域名均须包含 https://codingluke.site。
// 切换环境须重新编译、重新微信登录，不迁移开发环境会话和学习队列。
module.exports = {
  environment: 'production',
  apiBaseUrl: 'https://codingluke.site/v1',
  operatorContact: ''
};
