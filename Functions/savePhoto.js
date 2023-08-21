const AWS = require("aws-sdk");
const parser = require("lambda-multipart-parser");
const { v4: uuidv4 } = require('uuid');

const s3 = new AWS.S3();
const rekognition = new AWS.Rekognition();
const dynamodb = new AWS.DynamoDB.DocumentClient();

const BUCKET_NAME = process.env.BUCKET_NAME;
const COLLECTION_ID = "my-collection-id";
const PHOTOS_TABLE = process.env.PHOTOS_TABLE;

module.exports.indexFaces = async (event) => {
  const parsed = await parser.parse(event);

  const file = parsed.files[0];
  const comment = parsed.comment;
  const topic = parsed.topic; // Extract the topic
  const posterName = parsed.posterName;
  const sanitizedFilename = file.filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const extension = file.filename.split('.').pop();
  const key = `${sanitizedFilename}-${uuidv4()}.${extension}`; 

  await s3.putObject({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file.content,
  }).promise();

  const imageUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;

  const dbParams = {
    TableName: PHOTOS_TABLE,
    Item: {
      ExternalImageId: key,
      imageUrl: imageUrl,
      comments: [comment],
      topic: topic, // Store the topic
      posterName: posterName,
      timestamp: new Date().toISOString(), // Store timestamp
    },
  };

  await dynamodb.put(dbParams).promise();

  const params = {
    CollectionId: COLLECTION_ID,
    Image: {
      S3Object: {
        Bucket: BUCKET_NAME,
        Name: key,
      },
    },
    ExternalImageId: key,
  };

  const result = await rekognition.indexFaces(params).promise();
  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify({ ...result, imageUrl }),
  };
};
module.exports.recognizeFaces = async (event) => {
  try {
    const { files } = await parser.parse(event);
    const file = files[0];

    const params = {
      CollectionId: COLLECTION_ID,
      Image: {
        Bytes: file.content,
      },
      MaxFaces: 5,
      FaceMatchThreshold: 70,
    };

    const faces = await rekognition.searchFacesByImage(params).promise();

    const recognizedFaces = []; // Changed to an array
    for (const faceMatch of faces.FaceMatches) {
      const key = faceMatch.Face.ExternalImageId;
      const dbParams = {
        TableName: PHOTOS_TABLE,
        Key: {
          ExternalImageId: key,
        },
      };

      const result = await dynamodb.get(dbParams).promise();
      if (result.Item) {
        recognizedFaces.push(result.Item); // Only push the item if it's not null
      }
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true,
      },
      body: JSON.stringify({ faces: recognizedFaces }), // No need to filter faces here
    };
  } catch (error) {
    console.error("Error processing image:", error);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true,
      },
      body: JSON.stringify({ error: "An error occurred while processing the image." }),
    };
  }
};
