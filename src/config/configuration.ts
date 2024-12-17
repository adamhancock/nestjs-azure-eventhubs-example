export default () => ({
  eventHub: {
    connectionString: process.env.EVENT_HUB_CONNECTION_STRING || '',
  },
});
