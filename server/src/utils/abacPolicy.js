// src/utils/abacPolicy.js

/**
 * Compiles a zero-trust MongoDB filter from User (Subject), Document (Resource),
 * and Request (Environment) attributes.
 */
export const buildAbacFilter = (userOrRole, categoryFilter, options = {}) => {
  // Normalize input in case legacy callers pass a string role instead of req.user
  const user =
    typeof userOrRole === "string"
      ? { role: userOrRole, department: "general", clearanceLevel: 1 }
      : userOrRole || { role: "user", department: "general", clearanceLevel: 1 };

  // 1. Admin Override: Full access within the requested category
  if (user.role === "admin") {
    return {
      "metadata.category": { $eq: categoryFilter },
    };
  }

  // 2. Legacy Portfolio / Stranger Things Categories (Backwards Compatibility)
  if (categoryFilter === "portfolio_data" || categoryFilter === "stranger_things") {
    return {
      $and: [
        { "metadata.category": { $eq: categoryFilter } },
        { "metadata.visibility": { $eq: "public" } },
      ],
    };
  }

  const userDept = user.department || "general";
  const userClearance = Number(user.clearanceLevel) || 1;

  // 3. Environment Attribute Check (Optional: Business Hours 09:00 - 17:00)
  if (options.enforceBusinessHours) {
    const currentHour = new Date().getHours();
    const isBusinessHours = currentHour >= 9 && currentHour < 17;

    if (!isBusinessHours) {
      return {
        $and: [
          { "metadata.category": { $eq: categoryFilter } },
          { "metadata.department": { $eq: "public" } },
          { "metadata.clearanceRequired": { $lte: 1 } },
        ],
      };
    }
  }

  // 4. Multi-Department ABAC Rule:
  // Allow if (Document is "public" AND clearance <= userClearance)
  // OR (Document matches user's exact department AND clearance <= userClearance)
  return {
    $and: [
      { "metadata.category": { $eq: categoryFilter } },
      {
        $or: [
          {
            $and: [
              { "metadata.department": { $eq: "public" } },
              { "metadata.clearanceRequired": { $lte: userClearance } },
            ],
          },
          {
            $and: [
              { "metadata.department": { $eq: userDept } },
              { "metadata.clearanceRequired": { $lte: userClearance } },
            ],
          },
        ],
      },
    ],
  };
};