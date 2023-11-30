const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const ejsMate = require("ejs-mate");
const session = require("express-session");
const flash = require("connect-flash");
const methodOverride = require("method-override");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const catchAsync = require("./utils/catchAsync");
const User = require("./models/user");
const Apartment = require("./models/apartment");
const xml2js = require("xml2js");

const key =
  "CLce6nrfsFXfHRs/88XzAmoWAyKMitpJByuirDon+0VZiPutnUhb1ynL+TtsrT6TqAVBh4gjXdFMcOxRFgDUsQ==";
const url =
  "http://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/getRTMSDataSvcAptTradeDev";

mongoose.connect("mongodb://0.0.0.0:27017/apartment", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => {
  console.log("database connected");
});

const app = express();

app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(methodOverride("_method"));

app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("__method"));
app.use(express.static(path.join(__dirname, "public")));

const sessionConfig = {
  secret: "secret",
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
};

app.use(session(sessionConfig));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  next();
});

app.get("/", async (req, res) => {
  try {
    if (req.isAuthenticated()) {
      const user = await User.findById(req.user._id).populate("apartments");
      const apartments = user.apartments;
      const data = [];

      const startYear = 2023;
      const endYear = 2023;
      const startMonth = 1;
      const endMonth = 10;

      const fetchData = async (bcode, ymd) => {
        const params = {
          serviceKey: key,
          pageNo: "1",
          numOfRows: "9999",
          LAWD_CD: bcode,
          DEAL_YMD: ymd,
        };

        try {
          const response = await fetch(`${url}?${new URLSearchParams(params)}`);
          const xmlData = await response.text();

          const parser = new xml2js.Parser({
            explicitArray: false,
            trim: true,
          });
          parser.parseString(xmlData, (err, result) => {
            if (err) {
              console.error(err);
            } else {
              const items = result?.response?.body?.items?.item;
              if (items && Array.isArray(items)) {
                for (const item of items) {
                  for (const apartment of apartments) {
                    if (item?.도로명코드 === apartment.roadnameCode) {
                      const jsonData = JSON.stringify(item);
                      data.push(jsonData);
                    }
                  }
                }
              }
            }
          });
        } catch (error) {
          console.error("Error:", error);
        }
      };

      for (let year = startYear; year <= endYear; year++) {
        const start = year === startYear ? startMonth : 1;
        const end = year === endYear ? endMonth : 12;
        for (let month = start; month <= end; month++) {
          const ymd = `${year}${month < 10 ? "0" + month : month}`;
          for (const apartment of apartments) {
            await fetchData(apartment.bcode, ymd);
          }
        }
      }
      return res.render("home", { apartments, data });
    }
    res.render("home");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.post(
  "/register",
  catchAsync(async (req, res, next) => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const formattedDate = `${year}년 ${month}월 ${day}일`;

    try {
      const { email, username, password } = req.body;
      const user = new User({ email, username, registerDate: formattedDate });
      const registeredUser = await User.register(user, password);
      req.login(registeredUser, (err) => {
        if (err) return next(err);
        req.flash("success", "회원가입 완료");
        res.redirect("/");
      });
    } catch (e) {
      req.flash("error", e.message);
      res.redirect("/register");
    }
  })
);

app.get("/login", (req, res) => {
  res.render("login");
});

app.post(
  "/login",
  passport.authenticate("local", {
    failureFlash: true,
    failureRedirect: "/login",
    successFlash: true,
    successRedirect: "/",
  })
);

app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      req.flash("error", "로그아웃 중 오류가 발생했습니다.");
      return res.redirect("/");
    }
    req.flash("success", "로그아웃");
    res.redirect("/");
  });
});

app.get("/userData/:id", async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!req.isAuthenticated()) {
    req.flash("error", "로그인 필요");
    return res.redirect("/login");
  }
  res.render("userData", { user });
});

app.delete("/userData/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).populate("apartments");

    if (!user) {
      req.flash("error", "사용자를 찾을 수 없습니다.");
      return res.redirect("/");
    }

    await User.findByIdAndDelete(id);
    req.flash("success", "회원 탈퇴 완료");

    for (const apartment of user.apartments) {
      const otherUsersWithApartment = await User.findOne({
        apartments: apartment._id,
        _id: { $ne: id },
      });

      if (!otherUsersWithApartment) {
        await Apartment.findByIdAndDelete(apartment._id);
      }
    }

    res.redirect("/");
  } catch (error) {
    console.error(error);
    req.flash("error", "회원 탈퇴 중 오류가 발생했습니다.");
    res.redirect("/");
  }
});

app.get("/apartmentData/:id", async (req, res) => {
  if (!req.isAuthenticated()) {
    req.flash("error", "로그인 필요");
    return res.redirect("/login");
  }
  try {
    const user = await User.findById(req.params.id).populate("apartments");
    if (!user) {
      req.flash("error", "사용자를 찾을 수 없습니다.");
      return res.redirect("/");
    }

    res.render("apartmentData", { user });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

app.post("/apartmentData/:id", async (req, res) => {
  try {
    const {
      name,
      postcode,
      address,
      address2,
      bcode,
      references,
      roadnameCode,
    } = req.body;
    const existingApartment = await Apartment.findOne({ address });

    if (existingApartment) {
      req.flash("error", "이미 해당 주소의 아파트가 존재합니다.");
      return res.redirect(`/apartmentData/${req.params.id}`);
    }

    const apartment = new Apartment({
      name,
      postcode,
      address,
      address2,
      bcode,
      references,
      roadnameCode,
    });

    await apartment.save();
    const user = await User.findById(req.params.id);

    if (!user) {
      req.flash("error", "사용자를 찾을 수 없습니다.");
      return res.redirect("/");
    }

    user.apartments.push(apartment);
    await user.save();

    res.redirect(`/apartmentData/${req.params.id}`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

app.post("/apartmentData/:userId/delete/:apartmentId", async (req, res) => {
  const { userId, apartmentId } = req.params;

  try {
    const user = await User.findById(userId);
    if (!user) {
      req.flash("error", "사용자를 찾을 수 없습니다.");
      return res.redirect("/");
    }

    user.apartments.pull(apartmentId);
    await user.save();

    const otherUsersWithApartment = await User.findOne({
      apartments: apartmentId,
      _id: { $ne: userId },
    });

    if (!otherUsersWithApartment) {
      await Apartment.findByIdAndDelete(apartmentId);
    }

    req.flash("success", "아파트 정보 삭제 완료");
    res.redirect(`/apartmentData/${userId}`);
  } catch (error) {
    console.error(error);
    req.flash("error", "아파트 정보 삭제 중 오류가 발생했습니다.");
    res.redirect(`/apartmentData/${userId}`);
  }
});

app.listen(3000, () => {
  console.log("serving on port 3000");
});
