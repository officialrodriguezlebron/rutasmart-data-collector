import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:8000", // change to PC IP for phone testing
});

export const startTrip = (data) => API.post("/trip/start-trip", data);
export const endTrip = (tripId) => API.post(`/trip/end-trip/${tripId}`);
export const logGPS = (data) => API.post("/log/", data);

export default API;
