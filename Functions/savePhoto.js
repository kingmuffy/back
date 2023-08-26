const AWS = require("aws-sdk");
const parser = require("lambda-multipart-parser");
const { v4: uuidv4 } = require('uuid');

const s3 = new AWS.S3();
const rekognition = new AWS.Rekognition();
const dynamodb = new AWS.DynamoDB.DocumentClient();

const BUCKET_NAME = process.env.BUCKET_NAME;
const COLLECTION_ID = process.env.COLLECTION_ID || "my-collection-id";
const PHOTOS_TABLE = process.env.PHOTOS_TABLE;

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": true,
};

module.exports.indexFaces = async (event) => {
  try {
    const parsed = await parser.parse(event);

    if (!parsed.files || !parsed.files.length) {
      throw new Error("No files provided");
    }

    const file = parsed.files[0];
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
        imageUrl,
        comments: [parsed.comment],
        topic: parsed.topic,
        posterName: parsed.posterName,
        timestamp: new Date().toISOString(),
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
      headers: HEADERS,
      body: JSON.stringify({ ...result, imageUrl }),
    };
  } catch (error) {
    console.error("Error indexing faces:", error);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: "An error occurred while indexing the faces." }),
    };
  }
};

module.exports.recognizeFaces = async (event) => {
  try {
    const { files } = await parser.parse(event);
    if (!files || !files.length) {
      throw new Error("No files provided");
    }
    
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
    const recognizedFaces = [];

    for (const faceMatch of faces.FaceMatches) {
      const key = faceMatch.Face.ExternalImageId;
      const dbParams = {
        TableName: PHOTOS_TABLE,
        Key: { ExternalImageId: key },
      };

      const result = await dynamodb.get(dbParams).promise();
      if (result.Item) {
        recognizedFaces.push(result.Item);
      }
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ faces: recognizedFaces }),
    };
  } catch (error) {
    console.error("Error processing image:", error);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: "An error occurred while processing the image." }),
    };
  }
};
