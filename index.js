const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');
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

const apiKey = process.env.GEMINI_API_KEY; 

// Initialize GoogleGenerativeAI with your API key
const genAI = new GoogleGenerativeAI(apiKey);
const pdfExtract = new PDFExtract();

// In-memory store for extracted PDF data
let extractedPdfText = '';

async function analyzeText(fileContent) {
    console.log("File Content (Buffer):", fileContent);

    // Convert buffer to string if necessary
    let fileText;
    if (Buffer.isBuffer(fileContent)) {
        fileText = fileContent.toString('utf-8');
        console.log("buff");
    } else if (typeof fileContent === 'object') {
        // Convert object to JSON string if it's an object
        fileText = JSON.stringify(fileContent);
        console.log("obj");
    } else {
        // Assume it's already a string
        fileText = fileContent;
        console.log("str");
    }

    console.log("File Content (Stringified):", fileText);

    // Initialize the model
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // Define prompts with only the required fields
    const claimantPrompt = `Analyze the following text and extract the following information in JSON format:
        - Name: The full name of the customer
        - Vehicle Info: Details about the vehicle involved
        - Claim Status: The current status of the claim, which should be one of "Approved", "Rejected", or "Pending"
        - Claim Date: The date the claim was received
        - Reason: If the claim is rejected, provide the reason; if approved, provide the reason for approval
        - Items Covered: The item covered in the claim (Component)

        Here's the text to analyze:
        ${fileText}`;

    const dealerPrompt = `Analyze the following text and extract the following information in JSON format:
        - Name: The full name of the dealer
        - Location: The address of the dealership
        - Claim Status: The current status of the claim, which should be one of "Approved", "Rejected", or "Pending"
        - Claim Date: The date the claim was received
        - Reason: If the claim is rejected, provide the reason; if approved, provide the reason for approval
        - Items Covered: The item covered in the claim (Component)

        Here's the text to analyze:
        ${fileText}`;

    const serviceCenterPrompt = `Analyze the following text and extract the following information in JSON format:
        - Name: The name of the service center
        - Location: The location of the service center
        - Claim Status: The current status of the claim, which should be one of "Approved", "Rejected", or "Pending"
        - Claim Date: The date the claim was received
        - Reason: If the claim is rejected, provide the reason; if approved, provide the reason for approval
        - Items Covered: The item covered in the claim (Component)

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

// Function to format date in "Month Day, Year" format
function formatDate(dateStr) {
    const [year, month, day] = dateStr.split(':');
    const date = new Date(`${year}-${month}-${day}`);
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// function to check if it is below one month or not
function isValidClaimDate(metaDataDate, claimDate1) {
    const oneMonthAgoDate = new Date(claimDate1);
    oneMonthAgoDate.setMonth(oneMonthAgoDate.getMonth() - 1);
    return metaDataDate < oneMonthAgoDate;
}

// Function to convert image buffer to Base64 string
function imageToBase64(buffer) {
    return buffer.toString('base64');
  }

// POST route for extracting PDF and analyzing claim info
let itemCovered = null;
let claimDate = null;

app.post("/extract-pdf", upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send("No file uploaded.");
        }

        // Use a promise to handle the asynchronous nature of pdfExtract.extractBuffer
        const extractPdfText = () => {
            return new Promise((resolve, reject) => {
                pdfExtract.extractBuffer(req.file.buffer, {}, (err, data) => {
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
        
        // Analyze the extracted PDF text for claim information
        const claimInfo = await analyzeText(data);
        console.log("Claim Info:", claimInfo);

        // Store the itemCovered and claimDate in variables
        itemCovered = claimInfo["Items Covered"];
        claimDate = claimInfo["Claim Date"];
        console.log("Item Covered:", itemCovered);
        console.log("Claim Date:", claimDate);

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
app.post('/verify-metadata', upload.array('images', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).send('No files uploaded.');
        }

        // Process only the first uploaded file
        const file = req.files[0];
        const buffer = file.buffer;
        const tags = ExifReader.load(buffer);

        // Extract and format the DateTime
        const dateTimeExif = tags['DateTime']?.description;
        const formattedDate = formatDate(dateTimeExif.split(' ')[0]);

        const claimDateStr = new Date(claimDate); // Ensure claimDate is defined and properly set
        const formattedDateStr = new Date(formattedDate);

        if (isValidClaimDate(formattedDateStr, claimDateStr)) {
            return res.status(200).json({ message: 'Date is not valid', tags });
        } else {
            return res.status(200).json({ message: 'Valid Date', tags });
        }
    } catch (error) {
        console.error('Error reading EXIF data:', error.message);
        return res.status(500).send({ message: 'Error processing image.' });
    }
});


// Function to process and analyze the image
app.post('/analyze-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No file uploaded.');
        }

        const imageBuffer = req.file.buffer;
        console.log("img buff", imageBuffer)

        // Prepare the request payload
        const data = JSON.stringify({
            "contents": {
                "role": "user",
                "parts": [
                    {
                        "inlineData": {
                            "mimeType": req.file.mimetype,
                            "data": imageToBase64(imageBuffer)
                        }
                    },
                    {
                        "text": "Analyze the Image and tell me what object does the image contains. You must return in form of - object identified"
                    }
                ]
            }
        });

        const config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: process.env.MIRA_AI_URL,
            headers: {
                'model': process.env.MIRA_AI_MODEL,
                'access-key': process.env.MIRA_AI_ACCESS_KEY,
                'Content-Type': 'application/json'
            },
            data: data
        };

        // Make a request to the external API
        const response = await axios.request(config);
        console.log("API Response:", response.data);

        // Send the response back to the client
        return res.json(response.data);

    } catch (error) {
        console.error('Error processing image:', error.message);
        return res.status(500).send('Error processing image.');
    }
});

// Bind to all network interfaces
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});