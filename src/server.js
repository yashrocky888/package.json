const express = require('express');
const multer = require('multer');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs').promises;
const config = require('./config');
const { unlink } = require('fs').promises;

const app = express();
const port = process.env.PORT || 3000;

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, path.join(__dirname, '../public/uploads/'));
    },
    filename: function(req, file, cb) {
        cb(null, 'plant-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage
}).single('plantImage');

// Helper function to convert image to base64
async function fileToGenerativePart(path, mimeType) {
    const data = await fs.readFile(path);
    return {
        inlineData: {
            data: data.toString('base64'),
            mimeType
        }
    };
}

// Ensure required directories exist
const publicDir = path.join(__dirname, '../public');
const uploadDir = path.join(__dirname, '../public/uploads');
const cssDir = path.join(__dirname, '../public/css');

Promise.all([
    fs.mkdir(publicDir, { recursive: true }),
    fs.mkdir(uploadDir, { recursive: true }),
    fs.mkdir(cssDir, { recursive: true })
]).catch(console.error);

// Add this function
async function cleanupOldUploads() {
    try {
        const files = await fs.readdir(uploadDir);
        const now = Date.now();
        for (const file of files) {
            if (file === '.gitkeep') continue;
            const filePath = path.join(uploadDir, file);
            const stats = await fs.stat(filePath);
            // Delete files older than 1 hour
            if (now - stats.mtime.getTime() > 3600000) {
                await unlink(filePath);
            }
        }
    } catch (error) {
        console.error('Cleanup error:', error);
    }
}

// Add cleanup interval
setInterval(cleanupOldUploads, 3600000); // Run every hour

// Routes
app.get('/', (req, res) => {
    res.render('index', { result: null });
});

app.post('/upload', async (req, res) => {
    upload(req, res, async (err) => {
        try {
            if (err) {
                throw new Error('Error uploading file. Please try again.');
            }
            if (!req.file) {
                throw new Error('Please select an image to analyze.');
            }

            // Prepare the image for Gemini
            const imagePath = req.file.path;
            const mimeType = req.file.mimetype;
            const imagePart = await fileToGenerativePart(imagePath, mimeType);

            // Get Gemini model - updated to use gemini-1.5-pro
            const model = genAI.getGenerativeModel({ 
                model: "gemini-1.5-flash",
                generationConfig: {
                    temperature: 0.4,
                    topK: 32,
                    topP: 1,
                    maxOutputTokens: 4096,
                }
            });

            // Analyze the image with improved prompt
            const result = await model.generateContent([
                {
                    text: `You are a plant identification expert. Please analyze this plant image and provide:
                    1. Plant Identification: Name (both common and scientific) and plant family
                    2. Key Characteristics: Describe distinctive features, growth pattern, and appearance
                    3. Care Requirements:
                       - Light needs
                       - Watering schedule
                       - Soil preferences
                       - Temperature range
                       - Humidity requirements
                    4. Special Notes: Any unique features, toxicity warnings, or special care instructions
                    
                    Please format the response in a clear, structured way using markdown.`
                },
                imagePart
            ]);

            const response = await result.response;
            if (!response.candidates || response.candidates.length === 0) {
                throw new Error('No response generated');
            }
            const text = response.text();

            // Render the result
            res.render('index', { 
                result: text,
                image: '/uploads/' + req.file.filename
            });

        } catch (error) {
            console.error('Error:', error);
            res.render('index', { 
                error: error.message || 'An error occurred while analyzing the image. Please try again.',
                result: null
            });
        }
    });
});

app.listen(port, () => {
    console.log(`
        Server Status: Running
        Port: ${port}
        Environment: ${process.env.NODE_ENV}
        API Key Present: ${!!process.env.GEMINI_API_KEY}
        Upload Directory: ${uploadDir}
    `);
}); 