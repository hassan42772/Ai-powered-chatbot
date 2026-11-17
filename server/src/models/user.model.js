// src/models/user.model.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide a name"],
    },
    email: {
      type: String,
      required: [true, "Please provide an email"],
      unique: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: [true, "Please provide a password"],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    // --- NEW ABAC SUBJECT ATTRIBUTES ---
    department: {
      type: String,
      enum: ["general", "engineering", "finance", "hr"],
      default: "general",
    },
    clearanceLevel: {
      type: Number,
      min: 1,
      max: 3, // 1 = Basic, 2 = Confidential, 3 = Restricted
      default: 1,
    },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);



//ali.eng@company.com
//sara.fin@company.com
//usman.hr@company.com