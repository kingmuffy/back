const AWS = require("aws-sdk");
const formatPhotoResponse = require("../utils/formatPhotoResponse");
const dynamodb = new AWS.DynamoDB.DocumentClient();

module.exports.getPhotos = async () => {
    const dbParams = {
      TableName: process.env.PHOTOS_TABLE,
      limit: 50,
    };
  
    try {
      const result = await dynamodb.scan(dbParams).promise();
      return {
        statusCode: 200,
        body: JSON.stringify(formatPhotoResponse(result.Items)),
      };
    } catch (error) {
      console.error("Error fetching photos:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "An error occurred while fetching the photos." }),
      };
    }
  };
  
  