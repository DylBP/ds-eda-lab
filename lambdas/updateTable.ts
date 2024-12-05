import { SNSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, UpdateCommandInput } from "@aws-sdk/lib-dynamodb";

export const handler: SNSHandler = async (event: any) => {
    const ddbDocClient = createDDbDocClient();

    console.log("Event ", JSON.stringify(event));

    for (const record of event.Records) {
        const sns = record.Sns;
        const message = JSON.parse(sns.Message)

        try {

            const id = message.id
            const caption = message.caption
            const photographer = message.photographer
            const date = new Date().toISOString()
                .replace(/T/, ' ')
                .replace(/\..+/, '')

            const updateParams: UpdateCommandInput = {
                TableName: process.env.TABLE_NAME,
                Key: { filename: id },
                UpdateExpression: "SET #caption = :caption, #photographer = :photographer, #date = :date",
                ExpressionAttributeNames: {
                    "#caption": "caption",
                    "#photographer": "photographer",
                    "#date": "date"
                },
                ExpressionAttributeValues: {
                    ":caption": caption,
                    ":photographer": photographer,
                    ":date": date
                },
                ReturnValues: "ALL_NEW"
            };

            const result = await ddbDocClient.send(new UpdateCommand(updateParams))

            console.log(`Successfully added/updated item in ${process.env.TABLE_NAME}:`, result);
        } catch (error) {
            console.error("Error processing record:", error)
        }
    }
}

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