module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('products', 'video_url', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('products', 'video_url');
  }
}; 