const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  devServer: {
    host: '0.0.0.0',
    port: 8693,
    allowedHosts: 'all',
    // https: true,  // 如需 HTTPS，取消注释这行
    proxy: {
      '/api': {
        target: 'http://localhost:8699',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8699',
        ws: true,
      },
    },
  },
})
