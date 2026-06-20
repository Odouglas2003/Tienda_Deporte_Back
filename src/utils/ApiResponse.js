class ApiResponse {
  constructor({ success = true, message = 'OK', data = null, meta = null } = {}) {
    this.success = success
    this.message = message
    this.data = data
    this.meta = meta
  }
}

module.exports = ApiResponse
