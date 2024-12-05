import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Creating S3 Bucket -----------------------------------------
    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    // Integration infrastructure -----------------------------------------
    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });

    const badImageQueue = new sqs.Queue(this, "bad-image-queue", {
      retentionPeriod: Duration.minutes(10),
    })

    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      deadLetterQueue: {
        queue: badImageQueue,
        maxReceiveCount: 1,
      },
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });


    // DynamoDB Table -----------------------------------------
    const imageTable = new dynamodb.Table(this, "imagesTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "filename", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "imagesTable",
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Lambda functions -----------------------------------------
    const commonProperties = {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.seconds(10),
      memorySize: 128,
    }

    const processImageFn = new lambdanode.NodejsFunction(this, "ProcessImageFn", {
      ...commonProperties,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      environment: {
        TABLE_NAME: imageTable.tableName
      }
    });

    const updateTableFn = new lambdanode.NodejsFunction(this, "update-table-fn", {
      ...commonProperties,
      entry: `${__dirname}/../lambdas/updateTable.ts`,
      environment: {
        TABLE_NAME: imageTable.tableName
      }
    });

    const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
      ...commonProperties,
      entry: `${__dirname}/../lambdas/mailer.ts`,
    });

    const handleBadImage = new lambdanode.NodejsFunction(this, "handle-bad-image", {
      ...commonProperties,
      entry: `${__dirname}/../lambdas/handleBadImage.ts`,
    });

    // Event Source Mappings -----------------------------------------
    processImageFn.addEventSource(
      new events.SqsEventSource(imageProcessQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
        maxConcurrency: 2
      })
    );

    handleBadImage.addEventSource(
      new events.SqsEventSource(badImageQueue, {
        maxBatchingWindow: Duration.seconds(5),
        maxConcurrency: 2,
      })
    );


    // Notifications and Subscriptions -----------------------------------------
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );

    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED_DELETE,
      new s3n.SnsDestination(newImageTopic)
    );

    const filterPolicy = {
      metadata_type: sns.SubscriptionFilter.stringFilter({
        allowlist: ['Caption', 'Date', 'Photographer']
      })
    }

    newImageTopic.addSubscription(new subs.SqsSubscription(imageProcessQueue, {
      filterPolicyWithMessageBody: {
        Records: sns.FilterOrPolicy.policy({
          eventName: sns.FilterOrPolicy.filter(sns.SubscriptionFilter.stringFilter({
            allowlist: ["ObjectCreated:Put", "ObjectRemoved:Delete"]
          }))
        })
      }
    }));
    
    newImageTopic.addSubscription(new subs.LambdaSubscription(updateTableFn, { filterPolicy: filterPolicy }))
    mailerFn.addEventSource(new DynamoEventSource(imageTable, { startingPosition: StartingPosition.LATEST }))
  


    // Permissions  -----------------------------------------
    imagesBucket.grantRead(processImageFn);
    imageTable.grantReadWriteData(processImageFn)
    imageTable.grantReadWriteData(updateTableFn)
    imageTable.grantStreamRead(mailerFn)

    mailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    handleBadImage.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"],
        resources: ["*"],
      })
    )


    // Outputs -----------------------------------------
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName
    });

    new cdk.CfnOutput(this, "topicARN", {
      value: newImageTopic.topicArn
    })
  }
}