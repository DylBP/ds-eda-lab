import { SQSHandler } from "aws-lambda";

export const handler: SQSHandler = async (event) => {
  try {
    console.log("Event: ", JSON.stringify(event));
    for (const record of event.Records) {
      const message = JSON.parse(record.body)
      console.log(message.filename);
    }
  } catch (error) {
    console.log(JSON.stringify(error));
  }
};
