const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ApartmentSchema = new Schema({
  name: String,
  postcode: String,
  address: String,
  address2: String,
  bcode: String,
  references: String,
  roadnameCode: String,
});

module.exports = mongoose.model("Apartment", ApartmentSchema);
