/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {
  GetObjectCommand,
  GetObjectCommandInput,
  S3Client,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, DeleteCommandInput } from "@aws-sdk/lib-dynamodb";

const ddbDocClient = createDDbDocClient();
const s3 = new S3Client();

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);        // Parse SQS message
    const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

    // If there is a message record
    if (snsMessage.Records) {
      console.log("Record body ", JSON.stringify(snsMessage));

      // Go through each record
      for (const messageRecord of snsMessage.Records) {
        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;

        // Object key may have spaces or unicode non-ASCII characters.
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
        let origimage = null;

        // If we are sending a delete command, do the following...
        if (messageRecord.eventName == "ObjectRemoved:Delete") {
          try {
              const deleteParams: DeleteCommandInput = {
                  TableName: process.env.TABLE_NAME,
                  Key: { filename: srcKey }
              }

              const result = await ddbDocClient.send(new DeleteCommand(deleteParams))

              console.log(`Successfully deleted item from ${process.env.TABLE_NAME}:`, result)
          } catch (error) {
              console.error("Error deleting record:", error)
          }
      } else {

        if (!srcKey.endsWith(".jpeg") && !srcKey.endsWith(".png")) {
          console.error(`Unsupported File Type: ${srcKey}`)
          throw new Error("Invalid file type: Only .jpeg and .png files are allowed")
        }

        try {
          // Download the image from the S3 source bucket.
          const params: GetObjectCommandInput = {
            Bucket: srcBucket,
            Key: srcKey,
          };
          origimage = await s3.send(new GetObjectCommand(params));

          console.log(`Logging image ${srcKey} to DynamoDB`)

          const commandOutput = await ddbDocClient.send(
            new PutCommand({
              TableName: process.env.TABLE_NAME,
              Item: {
                filename: srcKey,
              },
            })
          )

          console.log(`Image ${srcKey} logged to DynamoDB successfully!`)

        } catch (error) {
          console.error(`Error processing image:`, error);
          throw error;
        }
      }
      }
    }
  }
};

function createDDbDocClient() {
  const ddbClient = new DynamoDBClient({ region: process.env.REGION });
  const marshallOptions = {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  };
  const unmarshallOptions = {
    wrapNumbers: false,
  };
  const translateConfig = { marshallOptions, unmarshallOptions };
  return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}