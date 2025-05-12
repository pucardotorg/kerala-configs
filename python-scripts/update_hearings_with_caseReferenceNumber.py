import requests
from datetime import datetime
import csv


env_url = "https://dristi-kerala-uat.pucar.org"
auth_token = "03ce5357-e25f-4746-aabc-7c9c63ad00bd"
hearing_search_endpoint = "/hearing/v1/search"
hearing_update_endpoint = "/hearing/v1/update"
case_search_endpoint = "/case/v1/_search"

headers = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-GB,en;q=0.9",
    "content-type": "application/json;charset=UTF-8",
    "sec-ch-ua": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Linux"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
}


def fetch_case(filingNumber):
    try:
        case_search_request = {
            "tenantId": "kl",
            "criteria": [{"filingNumber": filingNumber}],
            "tenantId": "kl",
            "RequestInfo": {
                "apiId": "Rainmaker",
                "authToken": auth_token,
                "msgId": "1741081826692|en_IN",
                "plainAccessRequest": {},
            },
        }

        case_response = requests.post(
            env_url + case_search_endpoint, headers=headers, json=case_search_request
        ).json()
        case_response_list = case_response["criteria"][0]["responseList"][0]
        print("case fetched successfully for ", filingNumber)
        return case_response_list
    except Exception as e:
        print("error in fetching case : ", filingNumber)
        return False


def update_hearing(hearing):
    body = {
        "hearing": hearing,
        "RequestInfo": {
            "apiId": "Rainmaker",
            "authToken": auth_token,
            "msgId": "1741081826692|en_IN",
            "plainAccessRequest": {},
        },
    }
    try:
        updated_hearing_response = requests.post(
            env_url + hearing_update_endpoint, headers=headers, json=body
        )
        print("Update hearing for filing: ", hearing["filingNumber"])
        return updated_hearing_response
    except Exception as e:
        print("Error in updating hearing", e)
        return e


# fetch all hearings
hearing_search_request = {
    "criteria": {"tenantId": "kl", "filingNumber": "KL-000759-2025"},
    "RequestInfo": {
        "apiId": "Rainmaker",
        "authToken": auth_token,
        "msgId": "1730970507148|en_IN",
        "plainAccessRequest": {},
    },
}
try:
    hearing_response = requests.post(
        env_url + hearing_search_endpoint, headers=headers, json=hearing_search_request
    ).json()
    if "HearingList" in hearing_response:
        hearing_response_list = hearing_response["HearingList"]
    else:
        if "Errors" in hearing_response:
            raise ValueError(hearing_response["Errors"][0]["message"])
        print(hearing_response)
        raise ValueError("HearingList is not present")
    print("Total no of hearings : ", len(hearing_response_list))
    current_date = datetime.now().strftime("%Y-%m-%d")
    file_name = current_date + "_update_hearing.csv"
    hearings_closed = 0
    with open(file_name, mode="a") as f:
        writer = csv.writer(f)
        if f.tell() == 0:
            writer.writerow(["hearing_id", "filing_number", "status", "response"])
        for hearing in hearing_response_list:
            filing_number = hearing["filingNumber"][0]
            if hearing["status"] not in ["HEARD", "ADJOURNED", "ABATED", "CLOSED"]:
                caseDetails = fetch_case(filing_number)
                if caseDetails == False:
                    continue
                hearing["cmpNumber"] = caseDetails["cmpNumber"]
                hearing["courtCaseNumber"] = caseDetails["courtCaseNumber"]
                hearing["caseReferenceNumber"] = (
                    caseDetails["courtCaseNumber"]
                    if caseDetails["courtCaseNumber"]
                    else caseDetails["cmpNumber"]
                )
                update_response = update_hearing(hearing)
                if not update_response.text:
                    writer.writerow(
                        [
                            hearing["hearingId"],
                            hearing["caseReferenceNumber"],
                            update_response.status_code,
                            "empty response",
                        ]
                    )
                if isinstance(update_response, str):
                    writer.writerow(
                        [
                            hearing["hearingId"],
                            hearing["caseReferenceNumber"],
                            update_response.status_code,
                            update_response,
                        ]
                    )
                else:
                    try:
                        update_response_json = update_response.json()
                        print(update_response_json, "error")
                        if isinstance(update_response_json, dict):
                            if "Errors" in update_response_json:
                                print("Error :", hearing["hearingId"])
                                writer.writerow(
                                    [
                                        hearing["hearingId"],
                                        hearing["caseReferenceNumber"],
                                        update_response.status_code,
                                        update_response_json,
                                    ]
                                )
                            else:
                                writer.writerow(
                                    [
                                        hearing["hearingId"],
                                        hearing["caseReferenceNumber"],
                                        update_response.status_code,
                                        update_response_json,
                                    ]
                                )
                        else:
                            writer.writerow(
                                [
                                    hearing["hearingId"],
                                    hearing["caseReferenceNumber"],
                                    update_response.status_code,
                                    update_response_json,
                                ]
                            )
                    except Exception as e:
                        writer.writerow(
                            [
                                hearing["hearingId"],
                                hearing["caseReferenceNumber"],
                                update_response.status_code,
                                e,
                            ]
                        )
            else:
                hearings_closed += 1
    print("Total no of hearings : ", len(hearing_response_list))
    print("Total no of hearings closed: ", hearings_closed)


except Exception as e:
    print(e)
