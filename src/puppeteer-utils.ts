import {ElementHandle} from "puppeteer";

export const getStringProperty = (propertyName: string) => async (element: ElementHandle): Promise<string> => {
    const property = await element.getProperty(propertyName);
    return await property.jsonValue() as string;
};
export const getInnerText = getStringProperty("innerText");
export const getValue = getStringProperty("value");
