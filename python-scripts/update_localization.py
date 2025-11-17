import csv
import requests

# env list we need to update the localization
env_list = [
    {
        "url": "dristi-kerala-dev.pucar.org",
        "password": "Beehyv@123",
        "username": "mdmsv2Super",
    },
     {
        "url": "dristi-kerala-qa.pucar.org",
        "password": "Beehyv@123",
        "username": "mdmsv2Qa",
    },
    # {
    #     "url": "oncourts-staging.kerala.gov.in",
    #     "password": "Beehyv@123",
    #     "username": "workbenchuser",
    # },
    # {
    #     "url": "dristi-kerala-uat.pucar.org",
    #     "password": "Beehyv@123",
    #     "username": "UATSUPERUSER",
    # },
    # {
    #     "url": "dristi-dev.pucar.org",
    #     "password": "Beehyv@123",
    #     "username": "mdmsDpgDev",
    # },
]

# files we need to do localization format code, text,module
file_data = [
    # {'filename': 'case.csv', 'module': 'case'},
    # {"filename": "submissions.csv", "module": "submissions"},
    # {'filename': 'home.csv', 'module': 'home'},
    # {'filename': 'hearings.csv', 'module': 'hearings'},
    # {"filename": "orders.csv", "module": "orders"},
    {"filename": "common.csv", "module": "common"},
]

# ,,

headers = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.7",
    "authorization": "Basic ZWdvdi11c2VyLWNsaWVudDo=",
    "content-type": "application/x-www-form-urlencoded",
    "origin": "https://dristi-kerala-dev.pucar.org",
    "priority": "u=1, i",
    "sec-ch-ua": '"Chromium";v="130", "Brave";v="130", "Not?A_Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Linux"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "sec-gpc": "1",
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
}
localization_headers = {"Content-Type": "application/json"}
data = {
    "userType": "EMPLOYEE",
    "tenantId": "kl",
    "scope": "read",
    "grant_type": "password",
}


def get_auth_token(url, headers, data):
    try:
        response = requests.post(url, headers=headers, data=data).json()
        return response["access_token"]
    except:
        print("some ting went wrong ")


for index in range(len(env_list)):
    env = env_list[index]
    env_url = "https://" + env["url"] + "/user/oauth/token?_=1731396254439"
    data["username"] = env["username"]
    data["password"] = env["password"]
    env["token"] = get_auth_token(env_url, headers, data)


for file_module in file_data:
    with open(file_module["filename"], mode="r") as file:
        csv_reader = csv.reader(file, quotechar='"', delimiter=',', quoting=csv.QUOTE_ALL)
        msg_index = 1
        module = "rainmaker-" + file_module["module"]
        # module = file_module["module"]
        for index, row in enumerate(csv_reader):
            try:
                text = str(row[msg_index])
                # if "{" in text or text == "-" or text == "NA":
                #     print("skiip", index, row[0])
                #     continue
                # if index == 1:
                #     break
                if row[0] and text:
                    for env in env_list:
                        loc_url = (
                            "https://"
                            + env["url"]
                            + "/localization/messages/v1/_upsert"
                        )
                        loc_data = {
                            "RequestInfo": {"authToken": env["token"]},
                            "tenantId": "kl",
                            "messages": [
                                {
                                    "code": row[0],
                                    "message": row[msg_index],
                                    "module": module,
                                    "locale": "en_IN",
                                }
                            ],
                        }
                        # print(data,url)
                        print(row[0], row[msg_index])
                        response = requests.post(
                            loc_url, headers=localization_headers, json=loc_data #, verify=False
                        )
                        if response.status_code != 200:
                            print(response.status_code)
                            break
            except Exception as e:
                print(e)
# CONDUCT_HEARING_BEFORE_ACTING_DCA,Conduct a hearing before acting on the DCA,rainmaker-submissions
# ENSURE_DUE_PROCESS,Ensure Due Process,rainmaker-submissions
 