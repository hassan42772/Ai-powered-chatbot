// src/scripts/seedAbac.js
import "dotenv/config";
import dns from "node:dns";
import net from "node:net";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/user.model.js";
import Knowledge from "../models/knowledge.model.js";
import { generateEmbedding } from "../services/rag.service.js";

dns.setDefaultResultOrder("ipv4first");
if (net.setDefaultAutoSelectFamily) {
  net.setDefaultAutoSelectFamily(false);
}

const DEPARTMENT_USERS = [
  {
    name: "Ali Engineering",
    email: "ali.eng@company.com",
    role: "user",
    department: "engineering",
    clearanceLevel: 2,
  },
  {
    name: "Sara Finance",
    email: "sara.fin@company.com",
    role: "user",
    department: "finance",
    clearanceLevel: 2,
  },
  {
    name: "Usman HR",
    email: "usman.hr@company.com",
    role: "user",
    department: "hr",
    clearanceLevel: 1,
  },
];

const COMPANY_DOCS = [
  {
    source: "general_handbook.md",
    content:
      "Company Remote Work & Leave Policy: All full-time employees receive 22 paid annual leaves. Friday is a company-wide remote work day.",
    metadata: {
      category: "company_data",
      department: "public",
      clearanceRequired: 1,
    },
  },
  {
    source: "eng_infrastructure.md",
    content:
      "Engineering Production Architecture (Clearance L2): Our core API runs on Node.js 20 behind NGINX with Redis Cluster caching and MongoDB Atlas M30 dedicated nodes.",
    metadata: {
      category: "company_data",
      department: "engineering",
      clearanceRequired: 2,
    },
  },
  {
    source: "eng_root_keys.md",
    content:
      "Engineering Disaster Recovery Vault (Clearance L3): Root KMS master key alias is prod-kms-root-eu-west-991. Access requires L3 clearance.",
    metadata: {
      category: "company_data",
      department: "engineering",
      clearanceRequired: 3,
    },
  },
  {
    source: "finance_runway.md",
    content:
      "Finance Q4 Burn & Runway Report (Clearance L2): Monthly AWS and Atlas infrastructure spend is $14,200. Net burn is $58,000/month with 20 months of cash runway.",
    metadata: {
      category: "company_data",
      department: "finance",
      clearanceRequired: 2,
    },
  },
  {
    source: "hr_onboarding.md",
    content:
      "HR Onboarding Procedure (Clearance L1): New employees must submit their CNIC copy, bank IBAN, and signed NDA within 48 hours of joining.",
    metadata: {
      category: "company_data",
      department: "hr",
      clearanceRequired: 1,
    },
  },
  {
    source: "hr_compensation.md",
    content:
      "HR Executive Salary Bands (Clearance L2): Senior AI Engineer salary band is PKR 450,000 to 650,000 per month plus annual performance bonus.",
    metadata: {
      category: "company_data",
      department: "hr",
      clearanceRequired: 2,
    },
  },
];

async function seedAbac() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing from .env");
    }

    await mongoose.connect(process.env.MONGO_URI);

    const hashedPassword = await bcrypt.hash("Test@1234", 10);

    for (const userData of DEPARTMENT_USERS) {
      await User.findOneAndUpdate(
        { email: userData.email },
        { ...userData, password: hashedPassword },
        { upsert: true, new: true }
      );
    }
    console.log("Seeded 3 department users (Password for all: Test@1234)");

    const formattedDocs = [];
    for (let i = 0; i < COMPANY_DOCS.length; i++) {
      const doc = COMPANY_DOCS[i];
      const embedding = await generateEmbedding(doc.content);

      formattedDocs.push({
        content: doc.content,
        embedding,
        metadata: {
          ...doc.metadata,
          source: doc.source,
          chunkIndex: i,
          totalChunks: COMPANY_DOCS.length,
        },
      });
    }

    await Knowledge.deleteMany({ "metadata.category": "company_data" });
    await Knowledge.insertMany(formattedDocs);

    console.log(`Seeded ${formattedDocs.length} ABAC documents under category 'company_data'.`);
  } catch (error) {
    console.error("ABAC seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seedAbac();