import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth,
         GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBFEvoFKoioRwv68ZQlwIZxp1rIEDg10qg",
  authDomain: "armyregsai.firebaseapp.com",
  projectId: "armyregsai",
  storageBucket: "armyregsai.firebasestorage.app",
  messagingSenderId: "373282340119",
  appId: "1:373282340119:web:ed744ab9bcb2fbf7428b52",
  measurementId: "G-RFWWGCE116"
};

  // Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const db = getFirestore(app);

export { auth, provider, db };