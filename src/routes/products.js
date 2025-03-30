const express = require('express');
const router = express.Router();
const ProductController = require('../controllers/ProductController');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: 'public/uploads/',
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

router.get('/products', ProductController.index);
router.post('/products', upload.single('image'), ProductController.store);
router.get('/products/category/:category_id', ProductController.getByCategory);
router.get('/products/:id', ProductController.getById);
router.put('/products/:id', upload.single('image'), ProductController.update);
router.delete('/products/:id', ProductController.delete);

module.exports = router; 