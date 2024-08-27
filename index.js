const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const ExifReader = require('exifreader');
const { PDFExtract } = require('pdf.js-extract');

dotenv.config();

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json()); // To parse JSON bodies
app.use(cors());

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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

    // console.log("File Content (Stringified):", fileText);

    // Initialize the model
    // const model = genAI.getGenerativeModel({ model: "gemini-pro" });

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
            const data = JSON.stringify({
                "contents": {
                    "role": "user",
                    "parts": [
                        {
                            "text": prompt
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
    
            const result = await axios.request(config);
    
            // The response is likely structured as result.data.message.content
            const responseContent = result.data.message.content;
            console.log("Raw Response Content:", responseContent);
    
            // Remove Markdown formatting if present and parse JSON
            let cleanedText = responseContent.replace(/^``` json\n/, '').replace(/\n```$/, '');
            
            // Additional debugging: Log the cleanedText before parsing
            console.log("Cleaned Response Text Before Parsing:", cleanedText);
    
            // Try parsing the cleaned response text as JSON
            try {
                return JSON.parse(cleanedText);
            } catch (jsonError) {
                console.error("JSON Parsing Error:", jsonError.message);
                console.log("Attempting to further clean the text...");
                
                // Additional cleaning attempts (e.g., remove backticks)
                cleanedText = cleanedText.replace(/`/g, '').trim();
                console.log("Further Cleaned Text:", cleanedText);
    
                return JSON.parse(cleanedText);
            }
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

let imageBuffer = null;
// POST route for reading EXIF data from an uploaded image file
app.post('/verify-metadata', upload.array('images', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).send('No files uploaded.');
        }

        // Process only the first uploaded file
        const file = req.files[0];
        imageBuffer = file.buffer;
        const fileBuffer = file.buffer;
        const tags = ExifReader.load(fileBuffer);
        console.log("Buffer Data", fileBuffer)
        console.log("tags", tags)

        // Extract and format the DateTime
        const dateTimeExif = tags['DateTime']?.description;
        const formattedDate = formatDate(dateTimeExif.split(' ')[0]);

        console.log("claim date", claimDate);
        console.log("image date", formattedDate)

        const claimDateStr = new Date(claimDate); // Ensure claimDate is defined and properly set
        const formattedDateStr = new Date(formattedDate);

        if (isValidClaimDate(formattedDateStr, claimDateStr)) {
            return res.status(200).json({ message: 'Please upload images that are taken recently', tags });
        } else {
            return res.status(200).json({ message: 'Valid Date', tags });
        }
    } catch (error) {
        console.error('Error reading EXIF data:', error.message);
        return res.status(500).send({ message: 'Error processing image.' });
    }
});


// Function to process and analyze the image
app.get('/analyze-image', async (req, res) => {
    try {
        console.log("img buff", imageBuffer)
        const mimeType = 'image/jpeg'; // Example MIME type

        // Prepare the request payload
        const data = JSON.stringify({
            "contents": {
                "role": "user",
                "parts": [
                    {
                        "inlineData": {
                            "mimeType": mimeType,
                            "data": imageBuffer.toString('base64')
                        }
                    },
                    {
                        "text": `Analyze the Image and tell me what object does the image contains. 
                        And I'll also give you an object name and give me the result that if both the given image and the object name given to you matches or not
                        The Output must be in JSON format of below
                        - Object Name -
                        - Analyzed Image -
                        - Matching percentage -. 
                        The object name is ${itemCovered}`
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

        // Extract the raw content from the response
        const rawContent = response.data.message.content;
        // Extract JSON from Markdown code block
        const jsonContentMatch = rawContent.match(/``` json\n([\s\S]*?)\n```/);
        console.log("josnio", jsonContentMatch);

         if (jsonContentMatch) {
            const jsonContent = jsonContentMatch[1].trim();
            console.log("Extracted JSON Content:", jsonContent);

            try {
                // Parse the JSON content
                const parsedJson = JSON.parse(jsonContent);
                // Construct the result object
                const matnum = parsedJson["Matching percentage"];
                const percentNum = parseInt(matnum.replace('%', ""));
                const matchingPercentage = percentNum; // Convert to number for comparison

                console.log("match %", matchingPercentage)

                let claimStatus;
                if (matchingPercentage < 80) {
                    claimStatus = {
                        status: "Claim Rejected",
                        reason: "The matching percentage is below the acceptable threshold."
                    };
                } else {
                    claimStatus = {
                        status: "Claim Authorized"
                    };
                }

                console.log("claim status", claimStatus);

                const result = {
                    "Object Name": parsedJson["Object Name"] || "N/A",
                    "Analyzed Image": (parsedJson[" Analyzed Image"] || ""), // Trim to remove any extra spaces
                    "Matching percentage": (parseInt(parsedJson["Matching percentage"].replace('%', "")) || "").trim(), // Trim to remove any extra spaces
                    "Claim Status": claimStatus
                };

                console.log("result", result);

                // Send the result back to the client
                return res.json(result);

            } catch (error) {
                console.error('Error parsing JSON content:', error.message);
                return res.status(500).send('Error parsing JSON content.');
            }
        } else {
            return res.status(500).send('No JSON content found in response.');
        }
    } catch (error) {
        console.error('Error processing image:', error.message);
        return res.status(500).send('Error processing image.');
    }
});

// Bind to all network interfaces
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});