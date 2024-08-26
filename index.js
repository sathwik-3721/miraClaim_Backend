const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const ExifReader = require('exifreader');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { PDFExtract } = require('pdf.js-extract');

dotenv.config();

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json()); // To parse JSON bodies
app.use(cors());

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const apiKey = process.env.GEMINI_API_KEY; // Make sure to set this in your .env file

// Initialize GoogleGenerativeAI with your API key
const genAI = new GoogleGenerativeAI(apiKey);
const pdfExtract = new PDFExtract();
const options = {};

// In-memory store for extracted PDF data
let extractedPdfText = '';

async function analyzeText(fileContent) {
    console.log("File Content (Buffer):", fileContent);

    // Convert buffer to string if necessary
    let fileText;
    if (Buffer.isBuffer(fileContent)) {
        fileText = fileContent.toString('utf-8');
        console.log("buff")
    } else if (typeof fileContent === 'object') {
        // Convert object to JSON string if it's an object
        fileText = JSON.stringify(fileContent);
        console.log("obj")
    } else {
        // Assume it's already a string
        fileText = fileContent;
        console.log("str")
    }

    console.log("File Content (Stringified):", fileText);

    // Initialize the model
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // Define prompts
    const claimantPrompt = `Analyze the following buffer data, convert it into text, and extract the following information in JSON format:
        - customerName: The full name of the customer
        - vehicleInfo: Details about the vehicle involved
        - customerEmail: The email address of the customer
        - claimStatus: The current status of the claim (e.g., approved, rejected, pending)
        - claimDate: The date the claim was received
        - rejectionReason: If the claim is rejected, provide the reason
        - approvedReason: If the claim is approved, provide the reason
        - itemCovered: The item covered in the claim (Component)

        Here's the text to analyze:
        ${fileText}`;

    const dealerPrompt = `Analyze the following buffer data, convert it into text, and extract the following information in JSON format:
        - dealerCode: The code assigned to the dealer
        - dealerName: The full name of the dealer
        - address: The address of the dealership
        - phone: The phone number of the dealership
        - claimStatus: The current status of the claim (e.g., approved, rejected, pending)
        - claimDate: The date the claim was received
        - rejectionReason: If the claim is rejected, provide the reason
        - approvedReason: If the claim is approved, provide the reason
        - itemCovered: The item covered in the claim (Component)

        Here's the text to analyze:
        ${fileText}`;

    const serviceCenterPrompt = `Analyze the following buffer data, convert it into text, and extract the following information in JSON format:
        - serviceCenterName: The name of the service center
        - serviceCenterLocation: The location of the service center
        - serviceCenterEmail: The email address of the service center
        - claimStatus: The current status of the claim (e.g., approved, rejected, pending)
        - claimDate: The date the claim was received
        - rejectionReason: If the claim is rejected, provide the reason
        - approvedReason: If the claim is approved, provide the reason
        - itemCovered: The item covered in the claim (Component)

        Here's the text to analyze:
        ${fileText}`;

    // Function to analyze content with a specific prompt
    async function analyzeWithPrompt(prompt) {
        try {
            const result = await model.generateContent(prompt);
            console.log("Result:", result);

            // Retrieve the response text
            const responseText = await result.response.text();
            console.log("Raw Response Text:", responseText);

            // Remove Markdown formatting (```json\n and \n```)
            const cleanedText = responseText.replace(/^```json\n/, '').replace(/\n```$/, '');

            console.log("Cleaned Response Text:", cleanedText);

            // Parse the cleaned response text as JSON
            return JSON.parse(cleanedText);
        } catch (error) {
            console.error("Error analyzing text:", error.message);
            return null;
        }
    }

    // Check content and use the appropriate prompt
    if (fileText.includes('Claimant Information:')) {
        return analyzeWithPrompt(claimantPrompt);
    } else if (fileText.includes('Dealer Information:')) {
        return analyzeWithPrompt(dealerPrompt);
    } else if (fileText.includes('Service Center Information:')) {
        return analyzeWithPrompt(serviceCenterPrompt);
    } else {
        console.error("Unknown information type.");
        return null;
    }
}



app.post("/extract-pdf", upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send("No file uploaded.");
        }

        // Use a promise to handle the asynchronous nature of pdfExtract.extractBuffer
        const extractPdfText = () => {
            return new Promise((resolve, reject) => {
                pdfExtract.extractBuffer(req.file.buffer, options, (err, data) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(data);
                    }
                });
            });
        };

        // Extract content from the uploaded PDF buffer
        const data = await extractPdfText();
        
        // Save the extracted text (or relevant parts)
        console.log("Extracted PDF Text:", data);

        // Analyze the extracted PDF text for claim information
        const claimInfo = await analyzeText(data);
        console.log("Claim Info:", claimInfo);

        // Respond with both the extracted PDF data and the analyzed claim info
        return res.json({
            claimInfo: claimInfo
        });
    } catch (error) {
        console.error("Error processing PDF request:", error.message);
        res.status(500).send("Error processing PDF.");
    }
});

// POST route for reading EXIF data from an uploaded image file
app.post('/metadata', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No file uploaded.');
        }

        // Read the image file from the uploaded buffer
        const buffer = req.file.buffer;

        // Parse EXIF data from the image buffer using exifreader
        const tags = ExifReader.load(buffer);

        // Send the extracted EXIF data as a JSON response
        res.json(tags);
    } catch (error) {
        console.error('Error reading EXIF data:', error.message);
        res.status(500).send('Error processing image.');
    }
});

// Bind to all network interfaces
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});