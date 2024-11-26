  var globalConfigs = (function () {
     var contextPath = "digit-ui";
     var stateTenantId = "kl";
     var configModuleName = "commonUiConfig";
     var centralInstanceEnabled = false;
     var localeRegion = "IN";
     var localeDefault = "en";
     var mdmsContext = "mdms-v2";
     var footerBWLogoURL = "https://pucarfilestore.blob.core.windows.net/pucar-filestore/pg/pucar-assets/digit-footer-bw.png";
     var footerLogoURL = "https://pucarfilestore.blob.core.windows.net/pucar-filestore/pg/pucar-assets/digit-footer.png";
     var digitHomeURL = "https://www.digit.org/";
     var assetS3Bucket = "pucarfilestore";
     var benchId = "BENCH_ID";
     var judgeId = "JUDGE_ID";
     var courtId = "KLKM52";
     var judgeName = "Smt. Soorya S Sukumaran";
     var WEBSOCKET_ADDRESS = "wss://dristi-dev.pucar.org/transcription"
     var invalidEmployeeRoles = ["CBO_ADMIN", "ORG_ADMIN", "ORG_STAFF", "SYSTEM"];

     var getConfig = function (key) {
         if (key === "STATE_LEVEL_TENANT_ID") {
           return stateTenantId;
         } else if (key === "GMAPS_API_KEY") {
           return gmaps_api_key;
         } else if (key === "ENABLE_SINGLEINSTANCE") {
           return centralInstanceEnabled;
         } else if (key === "DIGIT_FOOTER_BW") {
           return footerBWLogoURL;
         } else if (key === "DIGIT_FOOTER") {
           return footerLogoURL;
         } else if (key === "DIGIT_HOME_URL") {
           return digitHomeURL;
         } else if (key === "S3BUCKET") {
           return assetS3Bucket;
         } else if (key === "CONTEXT_PATH") {
           return contextPath;
         } else if (key === "UICONFIG_MODULENAME") {
           return configModuleName;
         } else if (key === "LOCALE_REGION") {
           return localeRegion;
         } else if (key === "LOCALE_DEFAULT") {
           return localeDefault;
         } else if (key === "MDMS_CONTEXT_PATH") {
           return mdmsContext;
         } else if (key === "INVALIDROLES") {
           return invalidEmployeeRoles;
         } else if (key === "BENCH_ID") {
           return benchId;
         } else if (key === "JUDGE_ID") {
           return judgeId;
         } else if (key === "WEBSOCKET_ADDRESS") {
           return WEBSOCKET_ADDRESS;
         } else if (key === "COURT_ID") {
           return courtId;
         } else if (key === "JUDGE_NAME") {
           return judgeName;
         }
     };

     return {
       getConfig,
     };
   })();