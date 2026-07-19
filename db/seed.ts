import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import * as dotenv from "dotenv";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is not defined");
}

async function main() {
  console.log("Connecting to PostgreSQL database...");
  const client = new Client({
    connectionString: databaseUrl,
  });
  await client.connect();
  console.log("Connected successfully.");

  const db = drizzle(client, { schema });

  try {
    console.log("Clearing existing database tables...");
    // Delete data in correct order to respect foreign key constraints
    await db.delete(schema.findings);
    await db.delete(schema.trendPoints);
    await db.delete(schema.scans);
    await db.delete(schema.repos);
    await db.delete(schema.user);
    console.log("Existing data cleared.");

    // 1. Seed demo user
    const demoUserId = "demo-user-id";
    console.log("Inserting demo user...");
    await db.insert(schema.user).values({
      id: demoUserId,
      name: "Demo Admin",
      email: "admin@acme.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 2. Seed canonical repo: acme/payments-infra
    const repoId = "9db0f5b9-7561-4c6e-8263-ea0c73335502";
    console.log("Inserting acme/payments-infra repository...");
    await db.insert(schema.repos).values({
      id: repoId,
      userId: demoUserId,
      url: "https://github.com/acme/payments-infra",
      name: "acme/payments-infra",
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
      lastScanAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      latestDriftScore: 0.93,
    });

    // 3. Seed latest scan
    const scanId = "c2a8f8d9-269e-4df8-8687-84ad1f83c162";
    console.log("Inserting completed scan...");
    await db.insert(schema.scans).values({
      id: scanId,
      repoId: repoId,
      status: "completed",
      startedAt: new Date(Date.now() - 2.5 * 60 * 60 * 1000),
      finishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    // 4. Seed findings
    console.log("Inserting findings...");
    const mockFindings = [
      {
        scanId: scanId,
        file: "terraform/security.tf",
        commit: "4f2a9c",
        author: "sarah.engineer@acme.com",
        timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        severity: "critical",
        score: 0.93,
        confidence: 0.98,
        changeSummary: "Ingress CIDR block widened from 10.0.0.0/16 to 0.0.0.0/0 on public security group.",
        evidence: {
          added: ["cidr_blocks = [\"0.0.0.0/0\"]"],
          removed: ["cidr_blocks = [\"10.0.0.0/16\"]"],
          rules: ["NET-01", "NET-04"],
          pattern_match: 0.93,
        },
        explanation: "The security group ingress rule was modified to allow unrestricted public access (0.0.0.0/0) to TCP port 5432 (PostgreSQL) instead of limiting it to the internal corporate CIDR (10.0.0.0/16). This exposes the primary transactional database directly to the public internet.",
        remediation: "Restrict the security group ingress source to internal VPC CIDR block 10.0.0.0/16 or configure a secure bastion host/VPN for remote database administration.",
      },
      {
        scanId: scanId,
        file: "docker-compose.prod.yml",
        commit: "8a1b2c",
        author: "john.developer@acme.com",
        timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        severity: "high",
        score: 0.89,
        confidence: 0.92,
        changeSummary: "Exposed port 22/tcp on service 'app' directly to host.",
        evidence: {
          added: ["ports:", "  - \"22:22\""],
          removed: [],
          rules: [], // Empty to prove similarity search adds value beyond rules
          pattern_match: 0.89,
        },
        explanation: "The production docker-compose file configuration maps SSH port 22 of the host machine directly to the internal application container. Because the rules array is empty, this finding was flagged strictly through similarity search against historic insecure port patterns rather than deterministic static analysis rules.",
        remediation: "Remove direct port mapping for SSH '22:22' from the docker-compose file. Access the container shell via secure cloud console, bastion hosts, or 'docker exec' command.",
      },
      {
        scanId: scanId,
        file: "k8s/deployment.yaml",
        commit: "9b3d4e",
        author: "emma.ops@acme.com",
        timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        severity: "high",
        score: 0.85,
        confidence: 0.94,
        changeSummary: "Security context modified to run container in privileged mode.",
        evidence: {
          added: ["securityContext:", "  privileged: true"],
          removed: ["privileged: false"],
          rules: ["K8S-03"],
          pattern_match: 0.85,
        },
        explanation: "The deployment security context was altered to run the pod with root-level privileges on the host system. This allows container breakout scenarios where an attacker can gain host access.",
        remediation: "Remove 'privileged: true' from the pod's security context or use Pod Security Standards to enforce non-privileged execution.",
      },
      {
        scanId: scanId,
        file: "src/main/resources/application.properties",
        commit: "3e7f2a",
        author: "david.dev@acme.com",
        timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
        severity: "medium",
        score: 0.78,
        confidence: 0.95,
        changeSummary: "Hardcoded production database password string.",
        evidence: {
          added: ["db.password=prod-db-master-p@ss123!"],
          rules: ["SEC-09"],
          pattern_match: 0.78,
        },
        explanation: "A cleartext database password credential was committed directly to the properties file. This allows anyone with read access to the source code repository to connect to the database.",
        remediation: "Remove cleartext password and use environment variable injection (e.g. ${DB_PASSWORD}) or retrieve secrets from a secrets manager (e.g. AWS Secrets Manager or HashiCorp Vault).",
      },
      {
        scanId: scanId,
        file: "Dockerfile",
        commit: "cf12ab",
        author: "luke.docker@acme.com",
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        severity: "low",
        score: 0.65,
        confidence: 0.88,
        changeSummary: "Missing USER directive in Dockerfile.",
        evidence: {
          added: ["# End of file without USER directive"],
          rules: ["DOCK-02"],
          pattern_match: 0.65,
        },
        explanation: "The Dockerfile does not declare a non-root USER before the entrypoint. By default, containers will execute as root, violating the principle of least privilege.",
        remediation: "Add a USER directive (e.g., 'USER node' or create a dedicated application user/group) near the end of the Dockerfile.",
      },
      {
        scanId: scanId,
        file: "src/auth/jwt.ts",
        commit: "7d6e5c",
        author: "frank.crypto@acme.com",
        timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
        severity: "critical",
        score: 0.95,
        confidence: 0.99,
        changeSummary: "Added weak default fallback secret for JWT signature verification.",
        evidence: {
          added: ["const secret = process.env.JWT_SECRET || 'dev-secret-key-12345';"],
          rules: ["JWT-01", "JWT-05"],
          pattern_match: 0.95,
        },
        explanation: "A hardcoded weak fallback JWT secret key was added. In production, if JWT_SECRET is unset, the application falls back to this public developer key, allowing anyone to forge administrative tokens.",
        remediation: "Throw a configuration error if process.env.JWT_SECRET is not defined, rather than falling back to a hardcoded string.",
      },
      {
        scanId: scanId,
        file: "aws/s3.tf",
        commit: "bc34de",
        author: "grace.cloud@acme.com",
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        severity: "high",
        score: 0.88,
        confidence: 0.96,
        changeSummary: "S3 bucket ACL changed from private to public-read.",
        evidence: {
          added: ["acl = \"public-read\""],
          removed: ["acl = \"private\""],
          rules: ["AWS-04"],
          pattern_match: 0.88,
        },
        explanation: "The S3 bucket access control list (ACL) was modified to allow global public read permissions, potentially exposing sensitive storage assets.",
        remediation: "Keep the bucket ACL set to 'private' and use signed URLs or CloudFront Origin Access Identities (OAI) for restricted public access.",
      },
      {
        scanId: scanId,
        file: "package.json",
        commit: "ad56ef",
        author: "hank.frontend@acme.com",
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        severity: "medium",
        score: 0.72,
        confidence: 0.90,
        changeSummary: "Downgraded lodash dependency to a vulnerable version.",
        evidence: {
          added: ["\"lodash\": \"4.17.15\""],
          removed: ["\"lodash\": \"4.17.21\""],
          rules: ["DEP-01"],
          pattern_match: 0.72,
        },
        explanation: "Reverted Lodash library from 4.17.21 to 4.17.15, reintroducing prototype pollution vulnerabilities (CVE-2020-8203).",
        remediation: "Keep lodash upgraded to version 4.17.21 or newer.",
      },
      {
        scanId: scanId,
        file: "nginx/nginx.conf",
        commit: "ef789a",
        author: "irene.ops@acme.com",
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        severity: "low",
        score: 0.58,
        confidence: 0.85,
        changeSummary: "nginx server_tokens enabled in main configuration block.",
        evidence: {
          added: ["server_tokens on;"],
          rules: ["NGX-02"],
          pattern_match: 0.58,
        },
        explanation: "Enabling 'server_tokens' causes Nginx to display version information in HTTP headers and default error pages, giving attackers details about server version exploits.",
        remediation: "Change the configuration directive to 'server_tokens off;' to hide version numbers.",
      },
      {
        scanId: scanId,
        file: "scripts/deploy.sh",
        commit: "fe901b",
        author: "jack.deploy@acme.com",
        timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000),
        severity: "medium",
        score: 0.81,
        confidence: 0.91,
        changeSummary: "Modified script execution permissions to chmod 777.",
        evidence: {
          added: ["chmod 777 scripts/deploy.sh"],
          rules: ["SH-01"],
          pattern_match: 0.81,
        },
        explanation: "The deployment script modifies permissions to 777 (read, write, execute for all users). This opens the door for local unprivileged users or malicious processes to modify the deployment script prior to execution.",
        remediation: "Use more restrictive permissions such as 755 (read/write/execute for owner, read/execute for others).",
      },
    ];

    await db.insert(schema.findings).values(mockFindings);
    console.log(`Inserted ${mockFindings.length} findings.`);

    // 5. Seed weekly trend points trending upward
    console.log("Inserting weekly trend points...");
    const trendScores = [0.12, 0.18, 0.25, 0.31, 0.42, 0.53, 0.60, 0.69, 0.81, 0.93];
    const trendPointsToInsert = trendScores.map((score, index) => {
      // Index 9 is today (0 weeks ago), Index 0 is 9 weeks ago
      const weeksAgo = 9 - index;
      const date = new Date(Date.now() - weeksAgo * 7 * 24 * 60 * 60 * 1000);
      return {
        repoId: repoId,
        date: date,
        score: score,
      };
    });

    await db.insert(schema.trendPoints).values(trendPointsToInsert);
    console.log(`Inserted ${trendPointsToInsert.length} weekly trend points.`);

    console.log("Database seeding completed successfully!");
  } catch (error) {
    console.error("Database seeding failed:", error);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Unhandle exception in seed runner:", err);
  process.exit(1);
});
