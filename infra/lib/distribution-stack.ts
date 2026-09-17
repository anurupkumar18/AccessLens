/**
 * Where the extension and its reviewed assets are served from.
 *
 * A Chrome extension is not "hosted" anywhere -- it installs into a browser.
 * What can be hosted is everything around it: the packed build people download
 * to install it, a page telling them how, and the versioned Access Pack assets
 * `SYSTEM_DESIGN.md` §7 already places on S3 + CloudFront behind
 * `VITE_ACCESSLENS_ASSET_BASE_URL`.
 *
 * CloudFront rather than an S3 website endpoint, because the extension fetches
 * pack assets cross-origin from whatever page the student is on, and that needs
 * HTTPS and CORS headers an S3 website endpoint does not provide.
 */
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AllowedMethods,
  Distribution,
  HttpVersion,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export class DistributionStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const bucket = new Bucket(this, 'AssetsBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      // Public access stays blocked; CloudFront reaches the bucket through
      // origin access control, so the bucket itself is never world-readable.
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // Everything here is rebuildable from the repository, and the account
      // disappears with the event. Retaining it would leave litter nobody owns.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          // The extension requests pack assets from arbitrary pages, so the
          // origin is genuinely unknowable. These are public reviewed teaching
          // assets, not user data.
          allowedOrigins: ['*'],
          allowedMethods: [HttpMethods.GET, HttpMethods.HEAD],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    const distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        responseHeadersPolicy: ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
      },
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2_AND_3,
      // Packs are versioned in their own path, so a short TTL is cheap
      // insurance against demoing a stale deck after a late content fix.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/index.html', ttl: Duration.minutes(5) },
      ],
      comment: 'AccessLens extension download and reviewed pack assets',
    });

    new CfnOutput(this, 'DistributionBucket', {
      value: bucket.bucketName,
      description: 'S3 bucket the deploy workflow publishes into',
    });
    new CfnOutput(this, 'DistributionUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Set as VITE_ACCESSLENS_ASSET_BASE_URL; also the install page',
    });
    // The deploy workflow invalidates this distribution after publishing. Its
    // role may create invalidations but not list distributions, so the id is
    // an output rather than something to look up.
    new CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution the deploy workflow invalidates',
    });
    new CfnOutput(this, 'ExtensionDownloadUrl', {
      value: `https://${distribution.distributionDomainName}/accesslens-extension.zip`,
      description: 'Packed extension for load-unpacked installation',
    });
  }
}
